import type { Cell, RobotId } from '../shared/types.ts';
import type { World } from './World.ts';

export type FaultEvent =
  | { t: number; kind: 'obstacle'; cells: Cell[] }
  | { t: number; kind: 'kill'; robot: RobotId | 'busiest' }
  | { t: number; kind: 'revive'; robot: RobotId };

/** Scheduled fault injection (scenario script), applied to ground truth only. */
export class FaultSchedule {
  private events: FaultEvent[];
  log: string[] = [];
  constructor(events: FaultEvent[]) {
    this.events = [...events].sort((a, b) => a.t - b.t);
  }
  apply(w: World): void {
    while (this.events.length && this.events[0].t <= w.t) {
      const e = this.events.shift()!;
      if (e.kind === 'obstacle') {
        for (const c of e.cells) if (w.setObstacle(c, true)) this.log.push(`t=${w.t} obstacle ${c}`);
      } else if (e.kind === 'kill') {
        const id = e.robot === 'busiest' ? pickVictim(w) : e.robot;
        w.kill(id);
        this.log.push(`t=${w.t} kill r${id}`);
      } else {
        w.revive(e.robot);
        this.log.push(`t=${w.t} revive r${e.robot}`);
      }
    }
  }
}

/** "Mid-task" victim: prefer a robot carrying a parcel, else the lowest id that is moving. */
function pickVictim(w: World): RobotId {
  const alive = w.bodies.filter((b) => b.alive);
  return (alive.find((b) => b.carrying) ?? alive.find((b) => b.busy === 'move') ?? alive[0]).id;
}
