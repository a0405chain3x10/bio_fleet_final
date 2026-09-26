import {
  HEARTBEAT_EVERY, LOW_BATTERY, CHARGE_UNTIL, MOVE_TICKS, T_FAIL, TASK_HOP_TTL, SENSOR_RANGE,
} from '../shared/constants.ts';
import { Grid } from '../shared/grid.ts';
import type { Msg } from '../shared/messages.ts';
import { Rng } from '../shared/rng.ts';
import { CellType, type Action, type Cell, type Dir, type Observation, type Outgoing, type RobotId, type Task } from '../shared/types.ts';
import { feasible, REFRESH_EVERY, SlotClaims } from './battery.ts';
import type { Agent, AgentConfig, AgentParams } from './contracts.ts';
import { PeerTable } from './peers.ts';
import { Planner, type PlanOpts } from './planner.ts';
import { PriorityClock } from './priority.ts';
import { checkMove, type SafetyVerdict } from './safety.ts';
import { TaskBook } from './tasks.ts';

type Payload = Msg extends infer M ? (M extends Msg ? Omit<M, 'from' | 'seq' | 't'> : never) : never;

export type Mode = 'idle' | 'toPickup' | 'toDrop' | 'toCharger' | 'charging' | 'parked' | 'retreat';

const FAIL_PENALTY = 300;
const SILENCE_RADIUS = 10;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

/** Behaviour shared by BioFleet and the baseline: inbox, CBAA, battery, goals, heartbeats, path following. */
export abstract class AgentCore implements Agent {
  readonly id: RobotId;
  readonly grid: Grid;
  readonly planner: Planner;
  readonly params: AgentParams;
  protected rng: Rng;
  protected t = 0;
  private seq = 0;
  protected out: Outgoing[] = [];
  readonly peers = new PeerTable();
  readonly tasks: TaskBook;
  protected slots: SlotClaims;
  readonly prio: PriorityClock;
  protected mission: Task[];
  mode: Mode = 'idle';
  goal: Cell = -1;
  path: Cell[] = [];
  protected planGoal: Cell = -1;
  protected lastPlanT = -1e9;
  protected slot: Cell = -1;
  private workPending: 'pick' | 'drop' | null = null;
  protected blocked = new Map<Cell, { until: number; src: 'sense' | 'msg' | 'fail' }>();
  blockedArr: Uint8Array;
  failPen: Float32Array;
  private lastRx = -1e9;
  protected blockedRev = 0;
  protected failed = new Map<RobotId, Cell[]>();
  private still = new Map<RobotId, { cell: Cell; to: Cell; since: number }>();
  protected lastDist = Infinity;
  lastProgressT = 0;
  waitReason = '';
  planMs = 0;
  protected cell: Cell = -1;
  protected heading: Dir = 0;

  constructor(cfg: AgentConfig) {
    this.id = cfg.id;
    this.grid = Grid.fromAscii(cfg.map);
    this.planner = new Planner(this.grid);
    this.params = cfg.params;
    this.rng = new Rng(cfg.seed * 7919 + cfg.id);
    this.tasks = new TaskBook(cfg.id, (m) => this.send(m as Payload));
    this.tasks.ownerAlive = (id) => {
      const p = this.peers.peers.get(id);
      return !!p && this.t - p.lastHeard <= T_FAIL;
    };
    this.slots = new SlotClaims(cfg.id);
    this.prio = new PriorityClock(cfg.id);
    this.mission = [...(cfg.mission ?? [])];
    this.blockedArr = new Uint8Array(this.grid.size);
    this.failPen = new Float32Array(this.grid.size);
  }

  protected send(m: Payload, to?: RobotId): void {
    const msg = { ...m, from: this.id, seq: this.seq++, t: this.t } as Msg;
    this.out.push(to === undefined ? { msg } : { to, msg });
  }

  step(o: Observation): Action {
    this.t = o.t;
    this.out = [];
    this.cell = o.self.cell;
    this.heading = o.self.heading;
    for (const m of o.inbox) this.ingest(m);
    this.senseObstacles(o);
    this.detectFailures(o);
    this.updateWork(o);
    this.taskLayer(o);
    this.chooseGoal(o);
    this.trackProgress();
    const a = this.act(o);
    this.periodic(o);
    a.outbox = this.out;
    a.telemetry = {
      state: this.mode, goal: this.goal, plan: this.path.slice(0, this.params.window), waitReason: this.waitReason,
      taskId: this.tasks.myTask, priority: this.prio.value, neighbours: this.peers.fresh(this.t, 20).length,
      planMs: this.planMs, corridor: this.corridorTelemetry(),
    };
    this.planMs = 0;
    return a;
  }

  protected corridorTelemetry(): { id: number; dir: number } | null {
    return null;
  }

  // ---------- inbox ----------
  protected ingest(m: Msg): void {
    if (m.from === this.id) return;
    this.lastRx = this.t;
    if (this.failed.has(m.from)) this.unfail(m.from);
    switch (m.type) {
      case 'HEARTBEAT': this.peers.onHeartbeat(m, this.t); break;
      case 'TASK':
        this.tasks.onTask(m, this.t);
        for (const r of this.tasks.takeRelays()) this.send(this.tasks.relayMsg(r));
        break;
      case 'BID': case 'RELEASE': case 'LOCK': this.onAuction(m); break;
      case 'DONE': this.tasks.onDone(m.taskId); break;
      case 'BLOCKED':
        if (!this.blocked.has(m.cell)) this.addBlocked(m.cell, this.t + m.ttl, 'msg');
        break;
      case 'CLEARED':
        if (this.blocked.get(m.cell)?.src === 'msg') this.removeBlocked(m.cell);
        break;
      default: this.peers.heard(m.from, this.t);
    }
    this.onPolicyMessage(m);
  }

  protected onPolicyMessage(_m: Msg): void {}

  private onAuction(m: Extract<Msg, { type: 'BID' | 'RELEASE' | 'LOCK' }>): void {
    this.peers.heard(m.from, this.t);
    const slot = SlotClaims.parse(m.taskId);
    if (slot === null) return this.tasks.onAuction(m, this.t);
    if (m.type === 'LOCK') this.slots.onLock(slot, m.bidder, this.t);
    else if (m.type === 'RELEASE') this.slots.onRelease(slot, m.bidder);
  }

  // ---------- world knowledge ----------
  /** Sensed obstacles and BLOCKED reports are hard; presumed-failed robots are a soft (uncertain) cost. */
  protected addBlocked(c: Cell, until: number, src: 'sense' | 'msg' | 'fail'): void {
    this.blocked.set(c, { until, src });
    if (src === 'fail') this.failPen[c] = FAIL_PENALTY;
    else this.blockedArr[c] = 1;
    this.blockedRev++;
  }
  protected removeBlocked(c: Cell): void {
    if (!this.blocked.delete(c)) return;
    this.blockedArr[c] = 0;
    this.failPen[c] = 0;
    this.blockedRev++;
  }

  private senseObstacles(o: Observation): void {
    const seen = new Set(o.obstacles);
    for (const c of o.obstacles)
      if (this.blocked.get(c)?.src !== 'sense') {
        this.addBlocked(c, Infinity, 'sense');
        this.send({ type: 'BLOCKED', cell: c, ttl: 600 });
      }
    const occupied = new Set(o.robots.flatMap((r) => [r.cell, r.to]));
    for (const [c, b] of this.blocked) {
      if (b.until < this.t) {
        this.removeBlocked(c);
        continue;
      }
      if (this.grid.chebyshev(c, this.cell) > SENSOR_RANGE || seen.has(c)) continue;
      if (b.src === 'fail' && occupied.has(c)) continue;
      this.removeBlocked(c); // I can see it is clear
      if (b.src !== 'fail') this.send({ type: 'CLEARED', cell: c, ttl: 0 });
    }
  }

  private detectFailures(o: Observation): void {
    // if I hear nobody at all, my own radio is the likelier culprit: presume nothing
    if (this.t - this.lastRx > 10) return;
    // a sensed robot frozen in place and silent on the radio is presumed failed
    for (const r of o.robots) {
      const known = this.failed.get(r.id);
      if (known && r.indicator >= 0) this.unfail(r.id); // its LED is on: alive after all
      else if (known) {
        const seen = r.to >= 0 ? [r.cell, r.to] : [r.cell];
        if (seen.some((c) => !known.includes(c)) || known.some((c) => !seen.includes(c))) {
          // I can see where the failed robot really is: move the obstacle there
          for (const c of known) if (this.blocked.get(c)?.src === 'fail') this.removeBlocked(c);
          this.failed.delete(r.id);
          this.markFailed(r.id, seen);
        }
      }
      const st = this.still.get(r.id);
      if (!st || st.cell !== r.cell || st.to !== r.to || r.indicator >= 0) this.still.set(r.id, { cell: r.cell, to: r.to, since: this.t });
      else if (this.t - st.since > T_FAIL && !this.failed.has(r.id) && !this.hearsFrom(r.id))
        this.markFailed(r.id, r.to >= 0 ? [r.cell, r.to] : [r.cell]);
    }
    if (this.t % 5) return;
    for (const p of this.peers.peers.values())
      if (!this.failed.has(p.id) && this.t - p.lastHeard > T_FAIL && p.cell >= 0 && this.nearby(p.cell)) this.markFailed(p.id, p.committed.length ? p.committed : [p.cell]);
    if (this.t % 50 === 0) for (const [id, st] of this.still) if (this.t - st.since > 600) this.still.delete(id);
  }

  /** close enough that silence is suspicious rather than just out of radio range */
  private nearby(c: Cell): boolean {
    const dx = this.grid.cx(c) - this.grid.cx(this.cell), dy = this.grid.cy(c) - this.grid.cy(this.cell);
    return dx * dx + dy * dy <= SILENCE_RADIUS * SILENCE_RADIUS;
  }

  private hearsFrom(id: RobotId): boolean {
    const p = this.peers.peers.get(id);
    return !!p && this.t - p.lastHeard <= T_FAIL;
  }

  /** Reopen its tasks and treat its cells as static obstacles until it is heard again. */
  private markFailed(id: RobotId, cells: Cell[]): void {
    this.failed.set(id, cells);
    this.tasks.reopenOwnedBy(id);
    this.slots.releaseAllOf(id);
    for (const c of cells) if (!this.blocked.has(c)) this.addBlocked(c, Infinity, 'fail');
  }

  private unfail(id: RobotId): void {
    for (const c of this.failed.get(id)!) if (this.blocked.get(c)?.src === 'fail') this.removeBlocked(c);
    this.failed.delete(id);
    this.still.delete(id);
  }

  // ---------- tasks ----------
  private updateWork(o: Observation): void {
    if (o.self.busy || !this.workPending) return;
    const w = o.self.lastWork;
    if (this.workPending === 'pick') {
      if (w === 'failed') this.tasks.markTaken();
      else if (w === 'picked' && o.self.carrying) {
        this.tasks.adopt(o.self.carrying, this.t);
        this.send({ type: 'LOCK', taskId: o.self.carrying, cost: -1, bidder: this.id });
      }
    } else if (w === 'dropped') {
      this.tasks.complete(this.t);
      this.mission.shift();
    } else if (w === 'failed') this.tasks.dropMine(true);
    this.workPending = null;
  }

  private taskLayer(o: Observation): void {
    if (!this.tasks.current && !this.tasks.myTask && this.mission.length && !o.self.carrying) {
      this.tasks.assign(this.mission[0], this.t);
      this.send({ type: 'LOCK', taskId: this.mission[0].id, cost: 0, bidder: this.id });
    }
    // owner-side re-auction when the route got >30% longer (e.g. blocked aisle), with hysteresis
    if (!this.mission.length && !o.self.carrying && this.t % 20 === this.id % 20 && this.tasks.current)
      this.tasks.maybeReauction(this.t, this.eta(true));
    const idle = !o.self.carrying && !this.needsCharge(o) && !this.mission.length;
    if (this.tasks.tick(this.t, idle, (task) => this.bidCost(o, task))) this.onTaskLocked(o);
  }

  protected onTaskLocked(_o: Observation): void {
    this.tasks.lockEta = this.eta(false);
    this.releaseSlot();
  }

  /** Remaining time estimate (ticks) for my locked task: planned path (with detours) or BFS distance. */
  protected eta(usePath: boolean): number {
    const task = this.tasks.current;
    if (!task) return 0;
    const toPick = usePath && this.goal === task.pickup && this.path.length ? this.path.length : this.distCells(this.cell, task.pickup);
    return (toPick + this.distCells(task.pickup, task.drop)) * MOVE_TICKS;
  }

  protected distCells(from: Cell, to: Cell): number {
    const d = this.planner.dists.get(to)[from];
    return d < 0 ? Infinity : d;
  }

  /** Path cost estimate (ticks) along the BFS gradient; subclasses add learned extras. */
  protected legCost(from: Cell, to: Cell): number {
    return this.distCells(from, to) * MOVE_TICKS;
  }

  protected bidCost(o: Observation, task: Task): number | null {
    const a = this.distCells(this.cell, task.pickup), b = this.distCells(task.pickup, task.drop);
    if (!isFinite(a) || !isFinite(b)) return null;
    const toChg = Math.min(...this.grid.stations(CellType.CHARGER).map((c) => this.distCells(task.drop, c)));
    if (!feasible(o.self.battery, a + b, toChg)) return null;
    const cost = this.legCost(this.cell, task.pickup) + this.legCost(task.pickup, task.drop) + (100 - o.self.battery) * 0.5;
    return Math.round(cost * 10) / 10;
  }

  protected needsCharge(o: Observation): boolean {
    return o.self.battery < LOW_BATTERY || ((this.mode === 'charging' || this.mode === 'toCharger') && o.self.battery < CHARGE_UNTIL);
  }

  // ---------- goals ----------
  private chooseGoal(o: Observation): void {
    const carrying = o.self.carrying;
    if (carrying) {
      const e = this.tasks.entries.get(carrying);
      this.setGoal('toDrop', e ? e.task.drop : this.goal);
      return;
    }
    if (this.needsCharge(o)) {
      if (this.tasks.myTask) this.tasks.dropMine(true);
      const c = this.claimSlot([CellType.CHARGER]);
      if (c < 0) this.setGoal(this.okToRest(this.cell) ? 'idle' : 'toCharger', this.cell); // all taken: wait for one
      else this.setGoal(this.cell === c ? 'charging' : 'toCharger', c);
      return;
    }
    const task = this.tasks.current;
    if (task) {
      this.releaseSlot();
      this.setGoal('toPickup', task.pickup);
      return;
    }
    if (this.mode === 'retreat' && this.goal >= 0 && this.retreatActive()) return;
    let park = this.claimSlot([CellType.BAY]);
    if (park < 0 && !this.okToRest(this.cell)) park = this.claimSlot([CellType.CHARGER]);
    this.setGoal(park === this.cell || park < 0 ? 'parked' : 'idle', park < 0 ? this.cell : park);
  }

  protected retreatActive(): boolean {
    return false;
  }

  protected setGoal(mode: Mode, goal: Cell): void {
    this.mode = mode;
    if (goal !== this.goal) {
      this.goal = goal;
      this.lastDist = Infinity;
    }
  }

  private claimSlot(types: CellType[]): Cell {
    if (this.slot >= 0 && types.includes(this.grid.type(this.slot)) && !this.slots.mustYield(this.slot, this.t) && !this.peerSits(this.slot)) return this.slot;
    this.releaseSlot();
    let best = -1, bd = Infinity;
    for (const ty of types)
      for (const c of this.grid.stations(ty)) {
        if (this.slots.takenByOther(c, this.t) || this.peerSits(c) || this.blockedArr[c] || this.failPen[c]) continue;
        const d = this.distCells(this.cell, c);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    if (best >= 0) {
      this.slot = best;
      this.send({ type: 'LOCK', taskId: SlotClaims.id(best), cost: 0, bidder: this.id });
    }
    return best;
  }

  /** Idle robots never rest on stations or in corridors. */
  private okToRest(c: Cell): boolean {
    return this.grid.type(c) === CellType.FLOOR && this.grid.corridorOf[c] < 0;
  }

  private peerSits(c: Cell): boolean {
    for (const p of this.peers.peers.values()) if (p.cell === c && this.t - p.lastHeard < 20) return true;
    return false;
  }

  protected releaseSlot(): void {
    if (this.slot < 0) return;
    this.send({ type: 'RELEASE', taskId: SlotClaims.id(this.slot), cost: 0, bidder: this.id });
    this.slot = -1;
  }

  private trackProgress(): void {
    const d = this.goal >= 0 ? this.distCells(this.cell, this.goal) : 0;
    if (d < this.lastDist || d === 0) {
      this.lastProgressT = this.t;
      this.prio.progress(this.t);
    }
    this.lastDist = Math.min(this.lastDist, d);
  }

  // ---------- acting ----------
  private act(o: Observation): Action {
    this.waitReason = '';
    const s = o.self;
    if (!s.busy && s.cell === this.goal) {
      this.path = [];
      const task = this.tasks.current;
      if (this.mode === 'toPickup' && task) {
        this.workPending = 'pick';
        return { kind: 'pick', taskId: task.id, indicator: -1, outbox: [] };
      }
      if (this.mode === 'toDrop' && s.carrying) {
        this.workPending = 'drop';
        return { kind: 'drop', taskId: s.carrying, indicator: -1, outbox: [] };
      }
      return this.restingAction(o) ?? { kind: 'wait', indicator: -1, outbox: [] };
    }
    if (s.busy && !s.moving) return { kind: 'wait', indicator: s.indicator, outbox: [] };
    return this.navigate(o);
  }

  protected abstract navigate(o: Observation): Action;

  /** Hook while resting at the goal (parked, charging). */
  protected restingAction(_o: Observation): Action | null {
    return null;
  }

  get now(): number {
    return this.t;
  }

  /** Learned per-edge extra delay (ticks), or null for static costs. */
  learnedCosts(): Float32Array | null {
    return null;
  }

  private periodic(o: Observation): void {
    const urgency = o.self.carrying ? 2 : o.self.battery < LOW_BATTERY ? 2 : this.tasks.current ? 1 : 0;
    if (this.prio.tick(this.t, urgency)) this.onEpoch();
    if (this.t % HEARTBEAT_EVERY === this.id % HEARTBEAT_EVERY) {
      this.send({
        type: 'HEARTBEAT', cell: o.self.cell, heading: o.self.heading, battery: Math.round(o.self.battery * 10) / 10,
        state: this.waitReason ? `${this.mode}:wait` : this.mode, priority: this.prio.value, taskId: o.self.carrying ?? this.tasks.myTask,
        committed: o.self.moving ? [o.self.cell, o.self.moveTarget] : [o.self.cell],
      });
    }
    if (this.slot >= 0 && this.t % REFRESH_EVERY === this.id % REFRESH_EVERY)
      this.send({ type: 'LOCK', taskId: SlotClaims.id(this.slot), cost: 0, bidder: this.id });
    if (this.t % 10 === 0) this.peers.evict(this.t);
  }

  protected onEpoch(): void {}

  // ---------- path following ----------
  /** Drop reached cells; while moving, the head is the cell after the move target. */
  protected trimPath(o: Observation): void {
    const here = o.self.moving ? o.self.moveTarget : o.self.cell;
    const i = this.path.indexOf(here);
    if (i >= 0) this.path = this.path.slice(i + 1);
    else if (this.path.length && this.grid.manhattan(here, this.path[0]) !== 1) this.path = [];
  }

  protected replan(o: Observation, opts: PlanOpts): boolean {
    const t0 = now();
    const from = o.self.moving ? o.self.moveTarget : o.self.cell;
    const hd = o.self.moving ? this.grid.dirTo(o.self.cell, o.self.moveTarget) : o.self.heading;
    const p = this.planner.plan(from, hd, this.goal, { blocked: this.blockedArr, ...opts });
    this.planMs += now() - t0;
    this.lastPlanT = this.t;
    this.planGoal = this.goal;
    if (p) this.path = p;
    return !!p;
  }

  /** Turn toward / signal / move into `next` using only the communication-free safety rule. */
  protected stepInto(o: Observation, next: Cell): { action: Action; verdict: SafetyVerdict | 'turn' } {
    const d = this.grid.dirTo(o.self.cell, next);
    if (d !== o.self.heading) return { action: { kind: 'turn', dir: d, indicator: next, outbox: [] }, verdict: 'turn' };
    const v = checkMove(o, next);
    if (v === 'go') return { action: { kind: 'move', dir: d, indicator: next, outbox: [] }, verdict: v };
    return { action: { kind: 'wait', indicator: next, outbox: [] }, verdict: v };
  }

  /** Who physically blocks `c` according to my sensors (for wait-for edges). */
  protected occupantOf(o: Observation, c: Cell): RobotId {
    for (const r of o.robots) if (r.cell === c || r.to === c) return r.id;
    return -1;
  }

  static readonly HOP_TTL = TASK_HOP_TTL;
}
