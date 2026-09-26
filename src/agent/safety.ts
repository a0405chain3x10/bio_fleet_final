import type { Cell, Observation } from '../shared/types.ts';

export type SafetyVerdict = 'go' | 'signal' | 'occupied' | 'yield-id' | 'obstacle';

/**
 * Communication-independent two-phase move rule (runs only when stationary at a cell centre).
 * Tick t: indicator = target. Tick t+1: move only if the indicator was already visible in this
 * snapshot, the target is free (incl. robots in transit), no lower-ID visible robot signals it,
 * and no obstacle is sensed there. All inputs come from onboard sensing of the same snapshot.
 */
export function checkMove(o: Observation, target: Cell): SafetyVerdict {
  if (o.self.indicator !== target) return 'signal';
  for (const c of o.obstacles) if (c === target) return 'obstacle';
  const me = o.self.id;
  for (const r of o.robots) {
    if (r.cell === target || r.to === target) return 'occupied';
    if (r.indicator === target && r.id < me) return 'yield-id';
  }
  return 'go';
}
