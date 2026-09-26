import type { Msg } from '../shared/messages.ts';
import { CellType, type Action, type Cell, type Observation, type RobotId } from '../shared/types.ts';
import type { AgentConfig } from './contracts.ts';
import { AgentCore } from './core.ts';
import { CorridorTable } from './corridor.ts';
import { buildEdgeCosts } from './costs.ts';
import { contested, freshIntent, headOnWith, mustYield, passingBlocker } from './passingOrder.ts';
import type { Peer } from './peers.ts';

export type { Agent, AgentConfig, AgentParams } from './contracts.ts';
export { DEFAULT_PARAMS } from './contracts.ts';

const MIN_REPLAN_GAP = 5;
const PASS_PATIENCE = 40;
const YIELD_MAX = 80;
const HEADON_PATIENCE = 30;
const QUEUE_DIST = 3;
/** waits I chose (not physical blocking): I should not hold up others while doing them */
const VOLUNTARY = /^(queue|corridor|pass)/;

interface YieldState {
  target: Cell;
  path: Cell[];
  forId: RobotId;
  until: number;
  vacate: Cell;
}

/** BioFleet: core behaviour + INTENT sharing, passing order, head-on yielding and corridor locks. */
export class BioFleetAgent extends AgentCore {
  readonly corridors: CorridorTable;
  readonly edgeCost: Float32Array;
  private replanFlag = false;
  private rev = -1;
  private lastCell: Cell = -1;
  private held: { cid: number; dir: number } | null = null;
  private reqSent = new Map<number, number>();
  private yieldState: YieldState | null = null;
  private passWait: { id: RobotId; since: number } | null = null;
  private headOnSince = -1;

  constructor(cfg: AgentConfig) {
    super(cfg);
    this.corridors = new CorridorTable(this.grid);
    this.edgeCost = new Float32Array(this.grid.size * 4);
  }

  protected onPolicyMessage(m: Msg): void {
    switch (m.type) {
      case 'HEARTBEAT': this.corridors.onPosition(m.from, m.cell, m.heading, this.t, m.t); break;
      case 'INTENT': {
        const p = this.peers.onIntent(m, this.t);
        if (p && this.path.slice(0, this.params.window).some((c) => m.path.includes(c))) this.replanFlag = true;
        break;
      }
      case 'LEFT': this.peers.onLeft(m.from, m.cell, this.t); break;
      case 'CORRIDOR': this.corridors.onMsg(m, this.t); break;
    }
  }

  protected corridorTelemetry() {
    return this.held ? { id: this.held.cid, dir: this.held.dir } : null;
  }

  private peerList(): Peer[] {
    return this.peers.fresh(this.t, 20).filter((p) => !this.failed.has(p.id));
  }

  // ---------- movement bookkeeping ----------
  private onCellChange(o: Observation): void {
    const cell = o.self.cell;
    if (cell === this.lastCell) return;
    const prev = this.lastCell;
    this.lastCell = cell;
    if (prev < 0) return;
    if (contested(prev, this.peerList(), this.t, this.id)) this.send({ type: 'LEFT', cell: prev });
    if (this.held && this.corridors.cid(cell) !== this.held.cid) {
      this.send({ type: 'CORRIDOR', corridorId: this.held.cid, direction: this.held.dir, holders: [], priority: this.prio.value, op: 'leave' });
      this.held = null;
    }
  }

  private announceIntent(): void {
    this.send({ type: 'INTENT', path: this.path.slice(0, this.params.window), priority: this.prio.value });
  }

  private plan(o: Observation): void {
    buildEdgeCosts(this);
    this.rev = this.blockedRev;
    this.replanFlag = false;
    this.replan(o, { edgeExtra: this.edgeCost, cellPenalty: this.failPen });
    this.announceIntent();
  }

  private needsPlan(): boolean {
    if (!this.path.length || this.planGoal !== this.goal || this.rev !== this.blockedRev) return true;
    const age = this.t - this.lastPlanT;
    return age >= this.params.replanEvery || (this.replanFlag && age >= MIN_REPLAN_GAP);
  }

  // ---------- main ----------
  protected navigate(o: Observation): Action {
    this.onCellChange(o);
    if (this.yieldState) return this.yieldStep(o);
    this.trimPath(o);
    if (this.needsPlan()) this.plan(o);
    const next = this.path[0] ?? -1;
    const from = o.self.moving ? o.self.moveTarget : o.self.cell;
    if (next < 0) {
      this.waitReason = 'no route';
      return { kind: 'wait', indicator: -1, outbox: [] };
    }
    this.requestCorridors(from);
    const gate = this.gate(o, from, next);
    if (o.self.moving) return { kind: 'wait', indicator: gate ? -1 : next, outbox: [] };
    const yielded = this.checkHeadOn(o, next) ?? (gate && VOLUNTARY.test(gate) ? this.makeRoom(o) ?? this.makeRoomSensed(o) : null);
    if (yielded) return yielded;
    if (gate) {
      this.waitReason = gate;
      return { kind: 'wait', indicator: -1, outbox: [] };
    }
    const { action, verdict } = this.stepInto(o, next);
    if (verdict === 'go') this.onDepart(from, next);
    else if (verdict !== 'turn' && verdict !== 'signal') this.waitReason = `blocked:${verdict}`;
    return action;
  }

  private onDepart(from: Cell, next: Cell): void {
    const cid = this.corridors.cid(next);
    if (cid >= 0 && cid !== this.corridors.cid(from)) {
      const dir = this.corridors.entryDir(from, next, this.path[1] ?? -1);
      this.held = { cid, dir };
      this.send({ type: 'CORRIDOR', corridorId: cid, direction: dir, holders: [this.id], priority: this.prio.value, op: 'join' });
    }
    this.passWait = null;
  }

  /** Coordination gate for the next cell: passing order + corridor lock. null = may go. */
  private gate(o: Observation, from: Cell, next: Cell): string | null {
    const cid = this.corridors.cid(next);
    const inCorr = this.corridors.cid(from) >= 0 && this.corridors.cid(from) === cid;
    if (cid >= 0 && !inCorr) {
      const dir = this.corridors.entryDir(from, next, this.path[1] ?? -1);
      const c = this.corridors.conflict(cid, dir, this.id, this.prio.value, this.t, o.robots);
      if (c) return c;
    }
    if (inCorr) return null;
    if (this.path.length > 1 && this.path.length <= QUEUE_DIST && this.goalTaken(o)) return 'queue';
    const p = passingBlocker(next, this.prio.value, this.peerList(), this.t);
    if (!p) {
      this.passWait = null;
      return null;
    }
    if (!this.passWait || this.passWait.id !== p.id) this.passWait = { id: p.id, since: this.t };
    // a higher-priority robot that is not moving would stall me forever: stop deferring to it
    if (this.t - this.passWait.since > PASS_PATIENCE) return null;
    return `pass:${p.id}`;
  }

  /** Someone else is on my goal cell (sensed or by heartbeat): queue at a distance, keep its exit clear. */
  private goalTaken(o: Observation): boolean {
    const g = this.goal;
    if (o.robots.some((r) => r.cell === g || r.to === g)) return true;
    for (const p of this.peerList()) if (p.cell === g && p.id !== this.id) return true;
    return false;
  }

  private requestCorridors(from: Cell): void {
    let prev = from;
    for (let i = 0; i < Math.min(3, this.path.length); i++) {
      const c = this.path[i], cid = this.corridors.cid(c);
      if (cid >= 0 && cid !== this.corridors.cid(prev)) {
        const last = this.reqSent.get(cid) ?? -1e9;
        if (this.t - last >= 10) {
          this.reqSent.set(cid, this.t);
          const dir = this.corridors.entryDir(prev, c, this.path[i + 1] ?? -1);
          this.send({ type: 'CORRIDOR', corridorId: cid, direction: dir, holders: [], priority: this.prio.value, op: 'req' });
        }
        return;
      }
      prev = c;
    }
  }

  // ---------- head-on yielding ----------
  private checkHeadOn(o: Observation, next: Cell): Action | null {
    const cell = o.self.cell;
    const p = headOnWith(cell, next, this.peerList(), this.t);
    if (!p) this.headOnSince = -1;
    else if (this.headOnSince < 0) this.headOnSince = this.t;
    const stale = p && this.t - this.headOnSince > HEADON_PATIENCE;
    if (p && (stale || mustYield(this.prio.value, this.pinned(cell), p, this.pinned(p.cell)))) {
      const a = this.startYield(o, p);
      if (a) return a;
    }
    // comm-free fallback: the robot in my next cell signals my cell (LED) → pinned robot keeps going,
    // otherwise the last known carried priority (or the lower id) wins
    const s = o.robots.find((r) => r.cell === next && r.indicator === cell && r.to < 0);
    if (s && !p) {
      const peer = this.peers.peers.get(s.id);
      const theirs = peer ? peer.priority : 999 - s.id;
      const pseudo = { priority: theirs } as Peer;
      if (mustYield(this.prio.value, this.pinned(cell), pseudo, this.pinned(s.cell))) return this.startYield(o, peer ?? null, s.id, [s.cell]);
    }
    return null;
  }

  /** I am waiting voluntarily: any robot signalling my cell (LED) gets room, even without radio. */
  private makeRoomSensed(o: Observation): Action | null {
    const s = o.robots.find((r) => r.indicator === o.self.cell && r.to < 0);
    return s ? this.startYield(o, null, s.id, [s.cell]) : null;
  }

  /** Cannot step aside here: corridor cell or dead-end pocket. */
  private pinned(c: Cell): boolean {
    if (this.corridors.cid(c) >= 0) return true;
    let n = 0;
    for (let d = 0; d < 4; d++) if (this.grid.nbr[c * 4 + d] >= 0) n++;
    return n <= 1;
  }

  /** Called by core when resting at the goal: step aside if a higher-priority robot needs my cell. */
  protected restingAction(o: Observation): Action | null {
    if (this.yieldState) return this.yieldStep(o);
    return this.makeRoom(o, true);
  }

  /** I am waiting anyway: if someone is about to need my cell, get out of its way. */
  private makeRoom(o: Observation, byPriority = false): Action | null {
    for (const p of this.peerList()) {
      if (!freshIntent(p, this.t) || (byPriority && p.priority <= this.prio.value)) continue;
      const i = p.intent.indexOf(o.self.cell);
      if (i >= 0 && i <= 2) return this.startYield(o, p);
    }
    return null;
  }

  private startYield(o: Observation, p: Peer | null, id = p?.id ?? -1, extraAvoid: Cell[] = []): Action | null {
    // may pass through the other's upcoming cells (backing out of its way) but must not stop on them
    const noStop = new Set<Cell>(p ? p.intent.slice(0, this.params.window) : []);
    const avoid = new Set<Cell>([...extraAvoid, ...(p ? [p.cell] : [])]);
    for (const r of o.robots) {
      avoid.add(r.cell);
      if (r.to >= 0) avoid.add(r.to);
    }
    const route = this.sideCell(o.self.cell, avoid, noStop);
    if (!route) return null;
    this.yieldState = { target: route[route.length - 1], path: route, forId: id, until: this.t + YIELD_MAX, vacate: o.self.cell };
    this.path = route;
    this.announceIntent();
    return this.yieldStep(o);
  }

  /** BFS to the nearest free cell off the other robot's path; bays preferred, corridors and stations avoided. */
  private sideCell(start: Cell, avoid: Set<Cell>, noStop: Set<Cell>): Cell[] | null {
    const g = this.grid, parent = new Map<Cell, Cell>([[start, -1]]);
    let frontier = [start];
    for (let depth = 0; depth < 16 && frontier.length; depth++) {
      const nextF: Cell[] = [];
      let found = -1;
      for (const c of frontier)
        for (let d = 0; d < 4; d++) {
          const m = g.nbr[c * 4 + d];
          if (m < 0 || parent.has(m) || avoid.has(m) || this.blockedArr[m]) continue;
          parent.set(m, c);
          nextF.push(m);
          const ty = g.type(m);
          const good = (ty === CellType.BAY || ty === CellType.FLOOR) && this.corridors.cid(m) < 0 && !noStop.has(m);
          if (good && (found < 0 || (ty === CellType.BAY && g.type(found) !== CellType.BAY))) found = m;
        }
      if (found >= 0) {
        const route: Cell[] = [];
        for (let c = found; c !== start; c = parent.get(c)!) route.push(c);
        return route.reverse();
      }
      frontier = nextF;
    }
    return null;
  }

  private yieldStep(o: Observation): Action {
    const y = this.yieldState!;
    const s = o.self;
    this.waitReason = `yield:${y.forId}`;
    const p = this.peers.peers.get(y.forId);
    const stillNeeded = p && freshIntent(p, this.t) && (p.intent.includes(y.vacate) || p.cell === y.vacate);
    if ((s.cell === y.target && !stillNeeded) || this.t > y.until) {
      this.yieldState = null;
      this.path = [];
      this.replanFlag = true;
      return { kind: 'wait', indicator: -1, outbox: [] };
    }
    const i = y.path.indexOf(s.moving ? s.moveTarget : s.cell);
    const next = y.path[i + 1] ?? (i < 0 ? y.path[0] : -1);
    if (s.moving) return { kind: 'wait', indicator: next, outbox: [] };
    if (next < 0 || this.grid.manhattan(next, s.cell) !== 1) return { kind: 'wait', indicator: -1, outbox: [] };
    return this.stepInto(o, next).action;
  }
}
