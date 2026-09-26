import { DEFAULT_PARAMS, type AgentConfig, type AgentParams } from '../agent/contracts.ts';
import { Grid } from '../shared/grid.ts';
import { hashSeed } from '../shared/rng.ts';
import { CellType, type Action, type Cell, type Dir, type Task, type Telemetry } from '../shared/types.ts';
import { FaultSchedule, type FaultEvent } from '../world/faults.ts';
import { Station, STATION_ID_BASE } from '../world/taskSource.ts';
import { World } from '../world/World.ts';
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
  /** preassigned missions per robot (S1–S3) */
  missions?: Task[][];
  faults?: FaultEvent[];
  maxTicks: number;
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
  telemetry: (Telemetry | undefined)[] = [];
  trace = 2166136261;

  constructor(cfg: SimConfig, runtime: AgentRuntime) {
    this.cfg = cfg;
    this.grid = Grid.fromAscii(cfg.map);
    this.world = new World(this.grid);
    this.runtime = runtime;
    for (const r of cfg.robots) this.world.addRobot(r.cell, r.heading ?? 1, r.battery ?? 100);
    const g = this.grid;
    const stationCells = g.stations(CellType.PICKUP);
    this.bus = new SimBus({ ...DEFAULT_BUS, ...cfg.bus, seed: cfg.seed }, (id) => {
      if (id >= STATION_ID_BASE) {
        const c = stationCells[id - STATION_ID_BASE];
        return { x: g.cx(c), y: g.cy(c) };
      }
      const b = this.world.bodies[id];
      return b.alive ? { x: g.cx(b.cell), y: g.cy(b.cell) } : null;
    });
    this.io = this.world.bodies.map((b) => this.bus.register(b.id));
    this.stations = stationCells.map((c, k) => new Station(STATION_ID_BASE + k, c, this.bus.register(STATION_ID_BASE + k)));
    for (const task of cfg.batch ?? []) {
      this.world.releaseTask(task);
      this.stations.find((s) => s.cell === task.pickup)?.add(task);
    }
    for (const m of cfg.missions ?? []) for (const task of m) this.world.releaseTask(task);
    this.faults = new FaultSchedule(cfg.faults ?? []);
    this.metrics = new Metrics(this.world.bodies.length);
  }

  agentConfigs(): AgentConfig[] {
    return this.world.bodies.map((b) => ({
      id: b.id, mode: this.cfg.mode, map: this.cfg.map, seed: hashSeed(this.cfg.seed, b.id),
      params: { ...DEFAULT_PARAMS, ...this.cfg.params }, mission: this.cfg.missions?.[b.id],
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
    for (const s of this.stations) s.tick(this.world);
    this.world.step(actions);
    this.metrics.record(this.world, this.telemetry);
    this.hashState();
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
    return (w.parcels.size > 0 && w.tasksDone() === w.parcels.size) || w.t >= this.cfg.maxTicks;
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
