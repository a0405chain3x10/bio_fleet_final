import type { Cell, RobotId } from '../shared/types.ts';

export interface CollisionEvent {
  t: number;
  a: RobotId;
  b: RobotId; // -1 = static obstacle
  cell: Cell;
}

/** Ground-truth collision logger. Keeps a total count and the most recent events only. */
export class CollisionLog {
  count = 0;
  recent: CollisionEvent[] = [];
  private occ: Int16Array;
  constructor(size: number) {
    this.occ = new Int16Array(size);
  }
  /** occupied: per robot the list of cells it physically covers this tick. */
  check(t: number, bodies: { id: RobotId; cells: Cell[] }[], obstacle: Uint8Array): void {
    const occ = this.occ;
    occ.fill(0);
    for (const b of bodies)
      for (const c of b.cells) {
        if (obstacle[c]) this.log({ t, a: b.id, b: -1, cell: c });
        const o = occ[c];
        if (o && o - 1 !== b.id) this.log({ t, a: o - 1, b: b.id, cell: c });
        else occ[c] = b.id + 1;
      }
  }
  private log(e: CollisionEvent): void {
    this.count++;
    this.recent.push(e);
    if (this.recent.length > 50) this.recent.shift();
  }
}
