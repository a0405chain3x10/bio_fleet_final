import { PEER_EVICT } from '../shared/constants.ts';
import type { HeartbeatMsg, IntentMsg } from '../shared/messages.ts';
import type { Cell, Dir, RobotId } from '../shared/types.ts';

export interface Peer {
  id: RobotId;
  cell: Cell;
  heading: Dir;
  battery: number;
  state: string;
  priority: number;
  taskId: string | null;
  committed: Cell[];
  lastHeard: number;
  hbSeq: number;
  intent: Cell[];
  intentSeq: number;
  intentT: number;
  /** cells this peer reported LEFT recently: cell → tick */
  left: Map<Cell, number>;
}

/** Everything this robot knows about others — built only from received messages. */
export class PeerTable {
  readonly peers = new Map<RobotId, Peer>();

  private get(id: RobotId, t: number): Peer {
    let p = this.peers.get(id);
    if (!p) {
      p = {
        id, cell: -1, heading: 0, battery: 0, state: '?', priority: 0, taskId: null, committed: [],
        lastHeard: t, hbSeq: -1, intent: [], intentSeq: -1, intentT: -1, left: new Map(),
      };
      this.peers.set(id, p);
    }
    return p;
  }

  heard(id: RobotId, t: number): void {
    this.get(id, t).lastHeard = t;
  }

  onHeartbeat(m: HeartbeatMsg, t: number): Peer | null {
    const p = this.get(m.from, t);
    p.lastHeard = t;
    if (m.seq <= p.hbSeq) return null; // stale/duplicate
    p.hbSeq = m.seq;
    p.cell = m.cell;
    p.heading = m.heading;
    p.battery = m.battery;
    p.state = m.state;
    p.priority = m.priority;
    p.taskId = m.taskId;
    p.committed = m.committed;
    if (p.intent.length) {
      // drop intent prefix the peer has already passed
      const i = p.intent.indexOf(m.cell);
      if (i >= 0) p.intent = p.intent.slice(i + 1);
    }
    return p;
  }

  onIntent(m: IntentMsg, t: number): Peer | null {
    const p = this.get(m.from, t);
    p.lastHeard = t;
    if (m.seq <= p.intentSeq) return null;
    p.intentSeq = m.seq;
    p.intent = m.path;
    p.intentT = t;
    p.priority = m.priority;
    return p;
  }

  onLeft(from: RobotId, cell: Cell, t: number): void {
    const p = this.get(from, t);
    p.lastHeard = t;
    p.left.set(cell, t);
    const i = p.intent.indexOf(cell);
    if (i >= 0) p.intent = p.intent.slice(i + 1);
  }

  /** Evict silent peers (bounded memory). */
  evict(t: number): void {
    for (const [id, p] of this.peers) {
      if (t - p.lastHeard > PEER_EVICT) this.peers.delete(id);
      else for (const [c, lt] of p.left) if (t - lt > PEER_EVICT) p.left.delete(c);
    }
  }

  fresh(t: number, maxAge: number): Peer[] {
    const out: Peer[] = [];
    for (const p of this.peers.values()) if (p.cell >= 0 && t - p.lastHeard <= maxAge) out.push(p);
    return out;
  }
}
