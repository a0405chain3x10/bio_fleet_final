import type { Msg } from './messages.ts';

export type RobotId = number;
/** Flat cell index y*W + x. -1 means "none". */
export type Cell = number;
/** 0=N 1=E 2=S 3=W */
export type Dir = 0 | 1 | 2 | 3;

export const CellType = {
  FLOOR: 0,
  SHELF: 1,
  PICKUP: 2,
  DROPOFF: 3,
  CHARGER: 4,
  BAY: 5,
  OBSTACLE: 6,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

export interface Task {
  id: string;
  pickup: Cell;
  drop: Cell;
  urgency: number;
}

/** What an onboard camera sees of another robot: fiducial ID, pose and LED intent indicator. */
export interface SensedRobot {
  id: RobotId;
  cell: Cell;
  heading: Dir;
  indicator: Cell;
  moving: boolean;
  /** second cell physically covered while between cells (-1 if at a cell centre) — seen, not signalled */
  to: Cell;
}

export type WorkResult = 'none' | 'picked' | 'dropped' | 'failed';

export interface SelfState {
  id: RobotId;
  cell: Cell;
  heading: Dir;
  busy: boolean;
  moving: boolean;
  /** target cell while moving, else -1 */
  moveTarget: Cell;
  /** the LED indicator as currently shown */
  indicator: Cell;
  battery: number;
  carrying: string | null;
  lastWork: WorkResult;
}

export interface Observation {
  t: number;
  self: SelfState;
  robots: SensedRobot[];
  obstacles: Cell[];
  inbox: Msg[];
}

export interface Outgoing {
  to?: RobotId;
  msg: Msg;
}

/** Debug/telemetry channel for the dashboard only. The World never reads it. */
export interface Telemetry {
  state: string;
  goal: Cell;
  plan: Cell[];
  waitReason: string;
  taskId: string | null;
  priority: number;
  neighbours: number;
  planMs: number;
  corridor?: { id: number; dir: number } | null;
}

export type ActionKind = 'move' | 'turn' | 'wait' | 'pick' | 'drop';

export interface Action {
  kind: ActionKind;
  dir?: Dir;
  taskId?: string;
  indicator: Cell;
  outbox: Outgoing[];
  telemetry?: Telemetry;
}

export const waitAction = (indicator: Cell = -1, outbox: Outgoing[] = []): Action => ({
  kind: 'wait',
  indicator,
  outbox,
});
