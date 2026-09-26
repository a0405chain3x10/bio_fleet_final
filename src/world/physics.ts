import {
  CHARGE_PER_SEC, DRAIN_PER_CELL, DRAIN_PER_IDLE_SEC, DRAIN_PER_TURN, MOVE_TICKS,
  TICKS_PER_SEC, TURN180_TICKS, TURN90_TICKS, WORK_TICKS, BATTERY_CAP,
} from '../shared/constants.ts';
import type { Grid } from '../shared/grid.ts';
import { CellType, type Action, type Cell, type Dir, type RobotId, type WorkResult } from '../shared/types.ts';

export type BusyKind = 'none' | 'move' | 'turn' | 'pick' | 'drop';

export interface Body {
  id: RobotId;
  cell: Cell;
  heading: Dir;
  alive: boolean;
  busy: BusyKind;
  remaining: number;
  target: Cell;
  turnTo: Dir;
  workTask: string | null;
  indicator: Cell;
  battery: number;
  carrying: string | null;
  lastWork: WorkResult;
  cellsMoved: number;
  lastCellChange: number;
}

export function makeBody(id: RobotId, cell: Cell, heading: Dir, battery: number): Body {
  return {
    id, cell, heading, alive: true, busy: 'none', remaining: 0, target: -1, turnTo: heading,
    workTask: null, indicator: -1, battery, carrying: null, lastWork: 'none', cellsMoved: 0, lastCellChange: 0,
  };
}

export function occupiedCells(b: Body): Cell[] {
  return b.busy === 'move' ? [b.cell, b.target] : [b.cell];
}

/** Start whatever the agent asked for, if physically possible. The World never second-guesses safety. */
export function startAction(g: Grid, b: Body, a: Action): void {
  if (b.busy !== 'none') return;
  if (b.battery <= 0 && a.kind !== 'wait') return;
  b.indicator = a.indicator;
  switch (a.kind) {
    case 'move': {
      if (a.dir === undefined || a.dir !== b.heading) return;
      const tgt = g.nbr[b.cell * 4 + a.dir];
      if (tgt < 0) return;
      b.busy = 'move';
      b.target = tgt;
      b.remaining = MOVE_TICKS;
      b.indicator = tgt;
      return;
    }
    case 'turn': {
      if (a.dir === undefined || a.dir === b.heading) return;
      b.busy = 'turn';
      b.turnTo = a.dir;
      b.remaining = (a.dir - b.heading + 4) % 4 === 2 ? TURN180_TICKS : TURN90_TICKS;
      return;
    }
    case 'pick':
    case 'drop':
      b.busy = a.kind;
      b.workTask = a.taskId ?? null;
      b.remaining = WORK_TICKS;
      b.lastWork = 'none';
      return;
    case 'wait':
      return;
  }
}

export interface WorkHooks {
  pick(b: Body, taskId: string | null): boolean;
  drop(b: Body, taskId: string | null): boolean;
}

/** Advance one tick of an ongoing action; returns true if the body changed cell. */
export function advance(g: Grid, b: Body, a: Action | undefined, t: number, hooks: WorkHooks): boolean {
  if (b.busy === 'none') {
    const perTick = 1 / TICKS_PER_SEC;
    if (g.type(b.cell) === CellType.CHARGER && a?.kind === 'wait')
      b.battery = Math.min(BATTERY_CAP, b.battery + CHARGE_PER_SEC * perTick);
    else b.battery = Math.max(0, b.battery - DRAIN_PER_IDLE_SEC * perTick);
    return false;
  }
  if (b.busy !== 'move' && a) b.indicator = a.indicator;
  if (--b.remaining > 0) return false;
  const kind = b.busy;
  b.busy = 'none';
  switch (kind) {
    case 'move':
      b.cell = b.target;
      b.target = -1;
      b.cellsMoved++;
      b.lastCellChange = t;
      b.battery = Math.max(0, b.battery - DRAIN_PER_CELL);
      // LED switches to whatever the agent is signalling next (set during the move)
      b.indicator = a ? a.indicator : -1;
      return true;
    case 'turn':
      b.heading = b.turnTo;
      b.battery = Math.max(0, b.battery - DRAIN_PER_TURN);
      return false;
    case 'pick':
      b.lastWork = hooks.pick(b, b.workTask) ? 'picked' : 'failed';
      return false;
    case 'drop':
      b.lastWork = hooks.drop(b, b.workTask) ? 'dropped' : 'failed';
      return false;
  }
  return false;
}
