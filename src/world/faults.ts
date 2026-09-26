import { CellType, type Cell, type RobotId } from '../shared/types.ts';
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

/** "Mid-task" victim: a robot driving with a parcel, else any robot driving (never parked on a station). */
function pickVictim(w: World): RobotId {
  const onFloor = (c: Cell): boolean => w.grid.type(c) === CellType.FLOOR;
  const alive = w.bodies.filter((b) => b.alive && b.busy === 'move' && onFloor(b.cell) && onFloor(b.target));
  return (alive.find((b) => b.carrying) ?? alive[0] ?? w.bodies.find((b) => b.alive)!).id;
}
