import { BATTERY_RESERVE, DRAIN_PER_CELL, DRAIN_PER_TURN } from '../shared/constants.ts';
import type { Cell, RobotId } from '../shared/types.ts';

/** Energy to drive `cells` cells, with a rough turn allowance. */
export const energyFor = (cells: number): number => cells * DRAIN_PER_CELL + Math.ceil(cells / 6) * DRAIN_PER_TURN;

export const feasible = (battery: number, taskCells: number, toChargerCells: number): boolean =>
  battery - energyFor(taskCells) - energyFor(toChargerCells) >= BATTERY_RESERVE;

const CLAIM_TTL = 60;
export const REFRESH_EVERY = 25;

/**
 * Parking/charging slot claims, allocated like tasks: a claim is a LOCK on "slot:<cell>",
 * kept alive by periodic re-LOCK; on a clash the lower id keeps the slot.
 */
export class SlotClaims {
  private claims = new Map<Cell, { owner: RobotId; t: number }>();
  readonly me: RobotId;
  constructor(me: RobotId) {
    this.me = me;
  }

  static id(c: Cell): string {
    return `slot:${c}`;
  }
  static parse(taskId: string): Cell | null {
    return taskId.startsWith('slot:') ? Number(taskId.slice(5)) : null;
  }

  onLock(c: Cell, owner: RobotId, t: number): void {
    const cur = this.claims.get(c);
    if (!cur || cur.owner === owner || t - cur.t > CLAIM_TTL || owner < cur.owner) this.claims.set(c, { owner, t });
  }
  onRelease(c: Cell, owner: RobotId): void {
    if (this.claims.get(c)?.owner === owner) this.claims.delete(c);
  }
  releaseAllOf(owner: RobotId): void {
    for (const [c, v] of this.claims) if (v.owner === owner) this.claims.delete(c);
  }
  /** true if someone with precedence holds a live claim */
  takenByOther(c: Cell, t: number): boolean {
    const cur = this.claims.get(c);
    return !!cur && cur.owner !== this.me && t - cur.t <= CLAIM_TTL;
  }
  /** a clash I must yield: other claim newer than TTL with lower id */
  mustYield(c: Cell, t: number): boolean {
    const cur = this.claims.get(c);
    return !!cur && cur.owner !== this.me && t - cur.t <= CLAIM_TTL && cur.owner < this.me;
  }
}
