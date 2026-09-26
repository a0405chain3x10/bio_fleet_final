import type { ProbeMsg } from '../shared/messages.ts';
import type { RobotId } from '../shared/types.ts';

export const PROBE_AFTER = 20; // ticks blocked on the same robot before probing
export const PROBE_EVERY = 30;

export type ProbeOutcome =
  | { kind: 'none' }
  | { kind: 'forward'; to: RobotId; path: RobotId[]; prios: number[] }
  | { kind: 'cycle'; victim: RobotId; members: RobotId[] }
  | { kind: 'retreat' };

/**
 * Chandy–Misra–Haas edge chasing over the wait-for graph. Each robot only knows whom it waits on;
 * a probe that returns to its initiator proves a cycle; the lowest carried priority in it retreats.
 */
export function onProbe(me: RobotId, myPrio: number, waitingOn: RobotId, m: ProbeMsg): ProbeOutcome {
  if (m.victim !== undefined) return m.victim === me ? { kind: 'retreat' } : { kind: 'none' };
  if (waitingOn < 0) return { kind: 'none' };
  if (m.initiator === me) {
    let victim = me, low = myPrio;
    m.path.forEach((id, i) => {
      if (m.prios[i] < low) {
        low = m.prios[i];
        victim = id;
      }
    });
    return { kind: 'cycle', victim, members: m.path };
  }
  if (m.path.includes(me) || m.path.length > 20) return { kind: 'none' };
  return { kind: 'forward', to: waitingOn, path: [...m.path, me], prios: [...m.prios, myPrio] };
}
