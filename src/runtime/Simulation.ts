import { DEFAULT_PARAMS, type AgentConfig, type AgentParams } from '../agent/contracts.ts';
import { Grid } from '../shared/grid.ts';
import { hashSeed, Rng } from '../shared/rng.ts';
import { CellType, type Action, type Cell, type Dir, type Task, type Telemetry } from '../shared/types.ts';
import { FaultSchedule, type FaultEvent } from '../world/faults.ts';
import { Station, STATION_ID_BASE } from '../world/taskSource.ts';
import { World } from '../world/World.ts';
import { RogueRobot, ROGUE_ID } from '../world/rogue.ts';
import { SimBus, type BusOpts } from '../transport/SimBus.ts';
import type { Transport } from '../transport/Transport.ts';
import type { AgentRuntime } from './Runtime.ts';
import { Metrics } from './metrics.ts';

export interface SimConfig {
  map: string[];
  robots: { cell: Cell; heading?: Dir; battery?: number }[];
  mode: 'biofleet' | 'baseline';
  seed: number;
  params?: Partial<AgentParams>;
  bus?: Partial<Omit<BusOpts, 'seed'>>;
  /** tasks published by pickup stations at t=0 (CBAA) */
  batch?: Task[];
  /** continuous mode: pickup stations publish this many new tasks per minute (seeded) */
  taskRate?: number;
  /** preassigned missions per robot (S1–S3) */
  missions?: Task[][];
  faults?: FaultEvent[];
  maxTicks: number;
  /** fleet HMAC key: every message is signed and verified (M10) */
  key?: string;
  /** add a rogue radio endpoint broadcasting forged positions/claims (M10) */
  rogue?: boolean;
}

export const DEFAULT_BUS: Omit<BusOpts, 'seed'> = { latency: [1, 2], loss: 0, range: 20, deadZones: [] };

export class Simulation {
  readonly cfg: SimConfig;
  readonly grid: Grid;
  readonly world: World;
  readonly bus: SimBus;
  readonly runtime: AgentRuntime;
  readonly metrics: Metrics;
  readonly faults: FaultSchedule;
  private io: Transport[] = [];
  private stations: Station[] = [];
  rogue: RogueRobot | null = null;
  telemetry: (Telemetry | undefined)[] = [];
  trace = 2166136261;
  private taskRng: Rng;
  private nextTaskAt = 0;
  private taskSeq = 0;

  constructor(cfg: SimConfig, runtime: AgentRuntime) {
    this.cfg = cfg;
    this.grid = Grid.fromAscii(cfg.map);
    this.world = new World(this.grid);
    this.runtime = runtime;
    for (const r of cfg.robots) this.world.addRobot(r.cell, r.heading ?? 1, r.battery ?? 100);
    const g = this.grid;
    const stationCells = g.stations(CellType.PICKUP);
    this.bus = new SimBus({ ...DEFAULT_BUS, ...cfg.bus, seed: cfg.seed }, (id) => {
      if (id === ROGUE_ID) return { x: g.w >> 1, y: g.h >> 1 };
      if (id >= STATION_ID_BASE) {
        const c = stationCells[id - STATION_ID_BASE];
        return { x: g.cx(c), y: g.cy(c) };
      }
      const b = this.world.bodies[id];
      return b.alive ? { x: g.cx(b.cell), y: g.cy(b.cell) } : null;
    });
    this.io = this.world.bodies.map((b) => this.bus.register(b.id));
    this.stations = stationCells.map((c, k) => new Station(STATION_ID_BASE + k, c, this.bus.register(STATION_ID_BASE + k), cfg.key));
    if (cfg.rogue) this.rogue = new RogueRobot(g, this.bus.register(ROGUE_ID), cfg.seed);
    for (const task of cfg.batch ?? []) {
      this.world.releaseTask(task);
      this.stations.find((s) => s.cell === task.pickup)?.add(task);
    }
    for (const m of cfg.missions ?? []) for (const task of m) this.world.releaseTask(task);
    this.faults = new FaultSchedule(cfg.faults ?? []);
    this.taskRng = new Rng(hashSeed(cfg.seed, 0x7a5));
    this.metrics = new Metrics(this.world.bodies.length);
  }

  agentConfigs(): AgentConfig[] {
    return this.world.bodies.map((b) => ({
      id: b.id, mode: this.cfg.mode, map: this.cfg.map, seed: hashSeed(this.cfg.seed, b.id),
      params: { ...DEFAULT_PARAMS, ...this.cfg.params }, mission: this.cfg.missions?.[b.id], key: this.cfg.key,
    }));
  }

  async init(): Promise<void> {
    await this.runtime.init(this.agentConfigs());
  }

  private observeAll() {
    this.faults.apply(this.world);
    this.bus.setTime(this.world.t);
    return this.world.bodies.map((b) => (b.alive ? this.world.observe(b.id, this.io[b.id].poll()) : null));
  }

  private applyAll(actions: (Action | undefined)[]): void {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (!a) continue;
      for (const o of a.outbox) (o.to === undefined ? this.io[i].broadcast(o.msg) : this.io[i].send(o.to, o.msg));
      this.telemetry[i] = a.telemetry;
    }
    this.generateTasks();
    this.rogue?.tick(this.world.t);
    for (const s of this.stations) s.tick(this.world);
    this.world.step(actions);
    this.metrics.record(this.world, this.telemetry);
    this.hashState();
  }

  /** Continuous WMS demand: seeded random pickup→dropoff tasks at `taskRate` per minute. */
  private generateTasks(): void {
    const rate = this.cfg.taskRate;
    if (!rate || this.world.t < this.nextTaskAt) return;
    const g = this.grid, rng = this.taskRng;
    const P = g.stations(CellType.PICKUP), D = g.stations(CellType.DROPOFF);
    if (!P.length || !D.length) return;
    const task = { id: `R${this.taskSeq++}`, pickup: rng.pick(P), drop: rng.pick(D), urgency: rng.next() < 0.2 ? 2 : 1 };
    this.world.releaseTask(task);
    this.stations.find((s) => s.cell === task.pickup)?.add(task);
    this.nextTaskAt = this.world.t + Math.max(1, Math.round(600 / rate));
  }

  tickSync(): void {
    if (!this.runtime.stepSync) throw new Error('runtime has no sync step');
    this.applyAll(this.runtime.stepSync(this.observeAll()));
  }

  async tick(): Promise<void> {
    this.applyAll(await this.runtime.step(this.observeAll()));
  }

  done(): boolean {
    const w = this.world;
    if (w.t >= this.cfg.maxTicks) return true;
    return !this.cfg.taskRate && w.parcels.size > 0 && w.tasksDone() === w.parcels.size;
  }

  runSync(): void {
    while (!this.done()) this.tickSync();
  }

  async run(): Promise<void> {
    while (!this.done()) await this.tick();
  }

  private hashState(): void {
    let h = this.trace;
    for (const b of this.world.bodies) {
      h = Math.imul(h ^ (b.cell + 1), 16777619);
      h = Math.imul(h ^ (b.indicator + 7), 16777619);
      h = Math.imul(h ^ (b.busy.length + b.heading * 8), 16777619);
    }
    this.trace = h >>> 0;
  }
}
