import type { Grid } from '../shared/grid.ts';
import type { Msg } from '../shared/messages.ts';
import type { Action, Cell, Dir, Observation, RobotId, Task } from '../shared/types.ts';
import { CollisionLog } from './collisions.ts';
import { advance, makeBody, occupiedCells, startAction, type Body, type WorkHooks } from './physics.ts';
import { sense } from './sensors.ts';

export interface Parcel {
  task: Task;
  status: 'waiting' | 'carried' | 'done';
  releasedAt: number;
  doneAt: number;
  carrier: RobotId;
  deliveries: number;
}

/**
 * Ground truth: physics/time, sensor simulation, collision logging. It never tells robots
 * where to go — robots only get sensor readings of their surroundings.
 */
export class World {
  t = 0;
  readonly grid: Grid;
  readonly bodies: Body[] = [];
  readonly obstacle: Uint8Array;
  readonly collisions: CollisionLog;
  readonly parcels = new Map<string, Parcel>();
  private occ: Int16Array;
  private hooks: WorkHooks;

  constructor(grid: Grid) {
    this.grid = grid;
    this.obstacle = new Uint8Array(grid.size);
    this.occ = new Int16Array(grid.size);
    this.collisions = new CollisionLog(grid.size);
    this.hooks = {
      pick: (b, id) => {
        const p = id ? this.parcels.get(id) : undefined;
        if (!p || p.status !== 'waiting' || p.task.pickup !== b.cell || b.carrying) return false;
        p.status = 'carried';
        p.carrier = b.id;
        b.carrying = id;
        return true;
      },
      drop: (b, id) => {
        const p = id ? this.parcels.get(id) : undefined;
        if (!p || b.carrying !== id || p.task.drop !== b.cell) return false;
        p.status = 'done';
        p.doneAt = this.t;
        p.deliveries++;
        b.carrying = null;
        return true;
      },
    };
  }

  addRobot(cell: Cell, heading: Dir = 1, battery = 100): RobotId {
    const id = this.bodies.length;
    const b = makeBody(id, cell, heading, battery);
    this.bodies.push(b);
    this.rebuildOcc();
    return id;
  }

  releaseTask(task: Task): void {
    if (this.parcels.has(task.id)) return;
    this.parcels.set(task.id, { task, status: 'waiting', releasedAt: this.t, doneAt: -1, carrier: -1, deliveries: 0 });
  }

  isOccupied(c: Cell): boolean {
    return this.occ[c] !== 0;
  }

  setObstacle(c: Cell, on: boolean): boolean {
    if (on && (this.occ[c] || !this.grid.passable(c))) return false;
    this.obstacle[c] = on ? 1 : 0;
    return true;
  }

  kill(id: RobotId): void {
    const b = this.bodies[id];
    if (!b?.alive) return;
    b.alive = false;
    b.indicator = -1;
    if (b.carrying) {
      // the WMS re-issues a replacement item at the pickup station
      const p = this.parcels.get(b.carrying);
      if (p) {
        p.status = 'waiting';
        p.carrier = -1;
      }
      b.carrying = null;
    }
  }

  revive(id: RobotId): void {
    const b = this.bodies[id];
    if (b) b.alive = true;
  }

  observe(id: RobotId, inbox: Msg[]): Observation {
    const b = this.bodies[id];
    const s = sense(this.grid, b, this.bodies, this.occ, this.obstacle);
    return {
      t: this.t,
      self: {
        id, cell: b.cell, heading: b.heading, busy: b.busy !== 'none', moving: b.busy === 'move',
        moveTarget: b.busy === 'move' ? b.target : -1, indicator: b.indicator,
        battery: b.battery, carrying: b.carrying, lastWork: b.lastWork,
      },
      robots: s.robots,
      obstacles: s.obstacles,
      inbox,
    };
  }

  /** Apply all actions simultaneously (decisions were taken on the same snapshot), then advance time. */
  step(actions: (Action | undefined)[]): void {
    const t = this.t;
    for (const b of this.bodies) {
      const a = actions[b.id];
      if (!b.alive) continue;
      if (a) startAction(this.grid, b, a);
      advance(this.grid, b, a, t, this.hooks);
    }
    this.rebuildOcc();
    this.collisions.check(t, this.bodies.map((b) => ({ id: b.id, cells: occupiedCells(b) })), this.obstacle);
    this.t++;
  }

  private rebuildOcc(): void {
    this.occ.fill(0);
    for (const b of this.bodies) for (const c of occupiedCells(b)) this.occ[c] = b.id + 1;
  }

  tasksDone(): number {
    let n = 0;
    for (const p of this.parcels.values()) if (p.status === 'done') n++;
    return n;
  }
}
