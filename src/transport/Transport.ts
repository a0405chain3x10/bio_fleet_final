import type { Msg } from '../shared/messages.ts';
import type { RobotId } from '../shared/types.ts';

/** The only channel for inter-robot information. */
export interface Transport {
  broadcast(msg: Msg): void;
  send(to: RobotId, msg: Msg): void;
  poll(): Msg[];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
