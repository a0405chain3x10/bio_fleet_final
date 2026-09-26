import type { Cell, Dir, RobotId } from './types.ts';

interface Base {
  from: RobotId;
  seq: number;
  t: number;
  sig?: string;
}

export interface HeartbeatMsg extends Base {
  type: 'HEARTBEAT';
  cell: Cell;
  heading: Dir;
  battery: number;
  state: string;
  priority: number;
  taskId: string | null;
  committed: Cell[];
}
export interface IntentMsg extends Base {
  type: 'INTENT';
  path: Cell[];
  priority: number;
}
export interface LeftMsg extends Base {
  type: 'LEFT';
  cell: Cell;
}
export interface CorridorMsg extends Base {
  type: 'CORRIDOR';
  corridorId: number;
  direction: number;
  holders: RobotId[];
  priority: number;
  op: 'req' | 'join' | 'leave';
}
export interface TaskMsg extends Base {
  type: 'TASK';
  id: string;
  pickup: Cell;
  drop: Cell;
  urgency: number;
  hopTTL: number;
}
export interface AuctionMsg extends Base {
  type: 'BID' | 'RELEASE' | 'LOCK';
  taskId: string;
  cost: number;
  bidder: RobotId;
}
export interface DoneMsg extends Base {
  type: 'DONE';
  taskId: string;
}
export interface BlockMsg extends Base {
  type: 'BLOCKED' | 'CLEARED';
  cell: Cell;
  ttl: number;
}
export interface ProbeMsg extends Base {
  type: 'PROBE';
  initiator: RobotId;
  path: RobotId[];
  prios: number[];
  victim?: RobotId;
}
export interface LearnMsg extends Base {
  type: 'LEARN';
  /** flattened triples: edgeIndex, delay (ticks), confidence */
  edges: number[];
}

export type Msg =
  | HeartbeatMsg
  | IntentMsg
  | LeftMsg
  | CorridorMsg
  | TaskMsg
  | AuctionMsg
  | DoneMsg
  | BlockMsg
  | ProbeMsg
  | LearnMsg;

export type MsgType = Msg['type'];
export const MSG_TYPES: MsgType[] = [
  'HEARTBEAT', 'INTENT', 'LEFT', 'CORRIDOR', 'TASK', 'BID', 'RELEASE', 'LOCK',
  'DONE', 'BLOCKED', 'CLEARED', 'PROBE', 'LEARN',
];

/** Byte-size estimate from field sizes (approximates JSON length without stringifying). */
export function msgBytes(m: Msg): number {
  let n = 40 + m.type.length + (m.sig ? m.sig.length + 8 : 0);
  switch (m.type) {
    case 'HEARTBEAT': return n + 70 + m.committed.length * 5 + (m.taskId?.length ?? 4) + m.state.length;
    case 'INTENT': return n + 20 + m.path.length * 5;
    case 'LEFT': return n + 10;
    case 'CORRIDOR': return n + 60 + m.holders.length * 4;
    case 'TASK': return n + 50 + m.id.length;
    case 'BID': case 'RELEASE': case 'LOCK': return n + 30 + m.taskId.length;
    case 'DONE': return n + 12 + m.taskId.length;
    case 'BLOCKED': case 'CLEARED': return n + 16;
    case 'PROBE': return n + 30 + m.path.length * 10;
    case 'LEARN': return n + 10 + m.edges.length * 5;
  }
}
