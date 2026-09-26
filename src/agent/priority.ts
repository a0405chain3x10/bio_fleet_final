import { EPOCH_TICKS, TICKS_PER_SEC } from '../shared/constants.ts';
import type { RobotId } from '../shared/types.ts';

const AGING_CAP = 60;

/** (urgencyClass, agingScore, -id) packed so that numeric order == lexicographic order. */
export function packPriority(urgency: number, agingSec: number, id: RobotId): number {
  return urgency * 1_000_000 + Math.min(AGING_CAP, Math.floor(agingSec)) * 1_000 + (999 - id);
}

/** Own priority, recomputed only at epoch boundaries; others' priorities are only ever read from messages. */
export class PriorityClock {
  value: number;
  agingBoost = 0;
  private lastProgressT = 0;
  readonly id: RobotId;
  constructor(id: RobotId) {
    this.id = id;
    this.value = packPriority(0, 0, id);
  }
  progress(t: number): void {
    this.lastProgressT = t;
    this.agingBoost = 0;
  }
  tick(t: number, urgency: number): boolean {
    if (t % EPOCH_TICKS !== 0) return false;
    const waited = (t - this.lastProgressT) / TICKS_PER_SEC + this.agingBoost;
    this.value = packPriority(urgency, waited, this.id);
    return true;
  }
}
