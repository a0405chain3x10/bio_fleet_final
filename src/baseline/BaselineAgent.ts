import { AgentCore } from '../agent/core.ts';
import type { Action, Cell, Observation } from '../shared/types.ts';

const BLOCKED_PATIENCE = 30; // 3 s
const TEMP_BLOCK = 50; // keep the occupied cell out of plans for 5 s

/**
 * Fair stop-and-wait baseline: same safety layer, CBAA, battery and parking rules; static
 * shortest paths, no INTENT/passing order/corridor locks/learned costs. Blocked → wait; after
 * 3 s blocked → random 1–3 s back-off, then replan with the occupied cell blocked.
 */
export class BaselineAgent extends AgentCore {
  private blockedSince = -1;
  private backoffUntil = -1;
  private tempBlock: Cell = -1;
  private tempUntil = -1;
  private rev = -1;
  private aside: Cell = -1;

  protected navigate(o: Observation): Action {
    const s = o.self;
    if (this.t < this.backoffUntil) {
      this.waitReason = 'backoff';
      return this.backoffStep(o);
    }
    this.trimPath(o);
    if (this.tempUntil > 0 && this.t >= this.tempUntil) {
      this.tempUntil = -1; // detour constraint expired: back to the static shortest path
      this.path = [];
    }
    if (!this.path.length || this.planGoal !== this.goal || this.rev !== this.blockedRev) this.plan(o);
    const next = this.path[0] ?? -1;
    if (s.moving) return { kind: 'wait', indicator: next, outbox: [] };
    if (next < 0) {
      this.waitReason = 'no route';
      return { kind: 'wait', indicator: -1, outbox: [] };
    }
    const { action, verdict } = this.stepInto(o, next);
    if (verdict === 'go' || verdict === 'turn' || verdict === 'signal') {
      if (verdict === 'go') this.blockedSince = -1;
      return action;
    }
    this.waitReason = `blocked:${verdict}`;
    if (this.blockedSince < 0) this.blockedSince = this.t;
    if (this.t - this.blockedSince >= BLOCKED_PATIENCE) {
      this.blockedSince = -1;
      this.backoffUntil = this.t + this.rng.int(10, 30);
      this.tempBlock = next;
      this.tempUntil = this.backoffUntil + TEMP_BLOCK;
      this.path = [];
      this.aside = -1;
      return this.backoffStep(o);
    }
    return action;
  }

  /**
   * Back-off: if a sensed robot signals the cell I stand on (head-on, seen via its LED), step
   * aside to a random free neighbour; otherwise just wait. Communication-free.
   */
  private backoffStep(o: Observation): Action {
    const s = o.self;
    if (s.busy) return { kind: 'wait', indicator: s.moving ? -1 : this.aside, outbox: [] };
    const wanted = o.robots.some((r) => !r.moving && r.indicator === s.cell);
    if (this.aside < 0 && wanted) {
      const opts: Cell[] = [];
      for (let d = 0; d < 4; d++) {
        const m = this.grid.nbr[s.cell * 4 + d];
        if (m >= 0 && m !== this.tempBlock && !this.blockedArr[m] && this.occupantOf(o, m) < 0) opts.push(m);
      }
      if (opts.length) this.aside = this.rng.pick(opts);
    }
    if (this.aside < 0 || this.aside === s.cell || this.grid.manhattan(this.aside, s.cell) !== 1) {
      this.aside = -1;
      return { kind: 'wait', indicator: -1, outbox: [] };
    }
    return this.stepInto(o, this.aside).action;
  }

  private plan(o: Observation): void {
    this.rev = this.blockedRev;
    const temp = this.t < this.tempUntil && this.tempBlock >= 0 && this.tempBlock !== this.goal && !this.blockedArr[this.tempBlock];
    if (temp) this.blockedArr[this.tempBlock] = 1;
    const ok = this.replan(o, { cellPenalty: this.failPen });
    if (temp) this.blockedArr[this.tempBlock] = 0;
    if (!ok && temp) this.replan(o, { cellPenalty: this.failPen });
  }
}
