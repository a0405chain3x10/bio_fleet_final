import { BID_DELAY, BID_WINDOW, REAUCTION_COOLDOWN, TASK_HOP_TTL } from '../shared/constants.ts';
import type { AuctionMsg, TaskMsg } from '../shared/messages.ts';
import type { RobotId, Task } from '../shared/types.ts';

export interface TaskEntry {
  task: Task;
  status: 'open' | 'locked' | 'done';
  owner: RobotId;
  ownerCost: number;
  bids: Map<RobotId, number>;
  bidT: Map<RobotId, number>;
  heardAt: number;
  lastReauction: number;
}

export type Emit = (m: { type: 'BID' | 'RELEASE' | 'LOCK'; taskId: string; cost: number; bidder: RobotId } | { type: 'DONE'; taskId: string } | Omit<TaskMsg, 'from' | 'seq' | 't'>) => void;

/** (cost, id) lexicographic: lower wins. */
const BID_EXPIRY = 50;
const STATION_BASE = 1000;

const beats = (c1: number, id1: number, c2: number, id2: number): boolean => c1 < c2 || (c1 === c2 && id1 < id2);

/**
 * Consensus-based auction (CBAA-style), no auctioneer: every robot applies the same rule to the
 * bids it heard. One outstanding bid per robot; winner confirmed by LOCK.
 */
export class TaskBook {
  readonly entries = new Map<string, TaskEntry>();
  readonly me: RobotId;
  private emit: Emit;
  myTask: string | null = null;
  myState: 'none' | 'bidding' | 'locked' = 'none';
  private myBidAt = 0;
  myCost = 0;
  lockEta = 0;
  private pendingRelay: TaskMsg[] = [];

  /** is this owner still heard from (not presumed failed)? */
  ownerAlive: (id: RobotId) => boolean = () => false;

  constructor(me: RobotId, emit: Emit) {
    this.me = me;
    this.emit = emit;
  }

  private entry(task: Task, t: number): TaskEntry {
    let e = this.entries.get(task.id);
    if (!e) {
      e = { task, status: 'open', owner: -1, ownerCost: Infinity, bids: new Map(), bidT: new Map(), heardAt: t, lastReauction: -1e9 };
      this.entries.set(task.id, e);
    }
    return e;
  }

  /** Preassigned mission task: locked to me without auction. */
  assign(task: Task, t: number): void {
    const e = this.entry(task, t);
    e.status = 'locked';
    e.owner = this.me;
    this.myTask = task.id;
    this.myState = 'locked';
  }

  onTask(m: TaskMsg, t: number): void {
    const known = this.entries.has(m.id);
    const e = this.entry({ id: m.id, pickup: m.pickup, drop: m.drop, urgency: m.urgency }, t);
    // a station re-advertises only when it has heard no owner for a while: treat as reopened
    if (known && m.from >= STATION_BASE && e.status === 'locked' && e.owner !== this.me && !this.ownerAlive(e.owner)) {
      e.status = 'open';
      e.owner = -1;
      e.ownerCost = Infinity;
    }
    if (!known && m.hopTTL > 0) this.pendingRelay.push(m);
  }

  takeRelays(): TaskMsg[] {
    const r = this.pendingRelay;
    this.pendingRelay = [];
    return r;
  }

  onAuction(m: AuctionMsg, t: number): void {
    const e = this.entries.get(m.taskId);
    if (!e) return;
    if (m.type === 'BID') {
      e.bids.set(m.bidder, m.cost);
      e.bidT.set(m.bidder, t);
      // owner re-asserts its lock so late bidders back off
      if (e.status === 'locked' && e.owner === this.me) this.emit({ type: 'LOCK', taskId: e.task.id, cost: e.ownerCost, bidder: this.me });
    } else if (m.type === 'RELEASE') {
      e.bids.delete(m.bidder);
      if (e.status === 'locked' && e.owner === m.bidder) {
        e.status = 'open';
        e.owner = -1;
        e.ownerCost = Infinity;
      }
    } else this.onLock(e, m, t);
  }

  private onLock(e: TaskEntry, m: AuctionMsg, t: number): void {
    e.bidT.set(m.bidder, t);
    if (e.status === 'done') return;
    if (this.myTask === e.task.id && m.bidder !== this.me) {
      if (this.myState === 'locked' && beats(this.myCost, this.me, m.cost, m.bidder)) {
        this.emit({ type: 'LOCK', taskId: e.task.id, cost: this.myCost, bidder: this.me });
        return;
      }
      this.dropMine(this.myState === 'locked');
    }
    if (e.status !== 'locked' || beats(m.cost, m.bidder, e.ownerCost, e.owner)) {
      e.status = 'locked';
      e.owner = m.bidder;
      e.ownerCost = m.cost;
    }
  }

  onDone(taskId: string): void {
    const e = this.entries.get(taskId);
    if (!e) return;
    e.status = 'done';
    e.bids.clear();
    if (this.myTask === taskId) {
      this.myTask = null;
      this.myState = 'none';
    }
  }

  /** Owner presumed failed: reopen its tasks. */
  reopenOwnedBy(id: RobotId): void {
    for (const e of this.entries.values())
      if (e.status === 'locked' && e.owner === id) {
        e.status = 'open';
        e.owner = -1;
        e.ownerCost = Infinity;
        e.bids.delete(id);
      }
  }

  /** Parcel was not on the shelf: someone else has it. Don't re-bid until a station re-advertises it. */
  markTaken(): void {
    if (!this.myTask) return;
    const e = this.entries.get(this.myTask);
    this.myTask = null;
    this.myState = 'none';
    if (!e) return;
    e.status = 'locked';
    e.owner = -2;
    e.ownerCost = -Infinity;
    e.bids.clear();
  }

  dropMine(release: boolean): void {
    if (!this.myTask) return;
    const e = this.entries.get(this.myTask);
    if (e) {
      e.bids.delete(this.me);
      if (e.owner === this.me) {
        e.status = 'open';
        e.owner = -1;
        e.ownerCost = Infinity;
      }
    }
    if (release) this.emit({ type: 'RELEASE', taskId: this.myTask, cost: 0, bidder: this.me });
    this.myTask = null;
    this.myState = 'none';
  }

  complete(t: number): void {
    if (!this.myTask) return;
    this.emit({ type: 'DONE', taskId: this.myTask });
    this.onDone(this.myTask);
    void t;
  }

  /** Is someone else's heard bid better than (cost, me)? */
  private outbid(e: TaskEntry, cost: number, t: number): boolean {
    for (const [id, c] of e.bids) {
      if (id === this.me) continue;
      if (t - (e.bidT.get(id) ?? t) > BID_EXPIRY) {
        e.bids.delete(id); // stale: its RELEASE was probably lost
        continue;
      }
      if (beats(c, id, cost, this.me)) return true;
    }
    return false;
  }

  /**
   * Called every tick. `cost(task)` returns null if infeasible (battery).
   * Returns true when this robot just locked a task.
   */
  tick(t: number, idle: boolean, cost: (task: Task) => number | null): boolean {
    if (this.myState === 'bidding') {
      const e = this.entries.get(this.myTask!)!;
      if (e.status !== 'open' || this.outbid(e, this.myCost, t)) {
        this.dropMine(true);
      } else if (t - this.myBidAt >= BID_WINDOW) {
        this.myState = 'locked';
        e.status = 'locked';
        e.owner = this.me;
        e.ownerCost = this.myCost;
        this.emit({ type: 'LOCK', taskId: e.task.id, cost: this.myCost, bidder: this.me });
        return true;
      }
      return false;
    }
    if (this.myState !== 'none' || !idle) return false;
    let best: TaskEntry | null = null, bestCost = Infinity;
    for (const e of this.entries.values()) {
      if (e.status !== 'open' || t - e.heardAt < BID_DELAY) continue;
      const c = cost(e.task);
      if (c === null || c >= bestCost || this.outbid(e, c, t)) continue;
      best = e;
      bestCost = c;
    }
    if (!best) return false;
    this.myTask = best.task.id;
    this.myState = 'bidding';
    this.myBidAt = t;
    this.myCost = bestCost;
    best.bids.set(this.me, bestCost);
    this.emit({ type: 'BID', taskId: best.task.id, cost: bestCost, bidder: this.me });
    return false;
  }

  /** Owner-side re-auction when ETA grew > 30% (hysteresis: once per task per 20 s). */
  maybeReauction(t: number, eta: number): boolean {
    if (this.myState !== 'locked' || !this.myTask) return false;
    const e = this.entries.get(this.myTask)!;
    if (eta <= this.lockEta * 1.3 || t - e.lastReauction < REAUCTION_COOLDOWN) return false;
    e.lastReauction = t;
    this.dropMine(true);
    e.lastReauction = t;
    return true;
  }

  relayMsg(m: TaskMsg): Omit<TaskMsg, 'from' | 'seq' | 't'> {
    return { type: 'TASK', id: m.id, pickup: m.pickup, drop: m.drop, urgency: m.urgency, hopTTL: Math.min(m.hopTTL, TASK_HOP_TTL) - 1 };
  }

  get current(): Task | null {
    return this.myState === 'locked' && this.myTask ? this.entries.get(this.myTask)!.task : null;
  }

  openCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.status === 'open') n++;
    return n;
  }
}
