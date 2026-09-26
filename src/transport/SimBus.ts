import { msgBytes, type Msg } from '../shared/messages.ts';
import { Rng } from '../shared/rng.ts';
import type { RobotId } from '../shared/types.ts';
import { inRect, type Rect, type Transport } from './Transport.ts';

export interface BusOpts {
  seed: number;
  latency: [number, number];
  loss: number;
  range: number;
  deadZones: Rect[];
}

export interface Pos {
  x: number;
  y: number;
}

export interface LinkEvent {
  from: RobotId;
  to: RobotId;
  t: number;
  type: Msg['type'];
}

interface Pending {
  due: number;
  msg: Msg;
}

export interface EndpointStats {
  sent: number;
  recv: number;
  bytesSent: number;
  bytesRecv: number;
}

/**
 * Seeded simulated radio: uniform latency, Bernoulli loss, Euclidean range, rectangular dead
 * zones. A bucketed spatial hash (bucket = range) keeps neighbour lookup O(n) per tick.
 */
export class SimBus {
  opts: BusOpts;
  private rng: Rng;
  private t = 0;
  private pos = new Map<RobotId, Pos | null>();
  private queues = new Map<RobotId, Pending[]>();
  readonly stats = new Map<RobotId, EndpointStats>();
  private hash = new Map<number, RobotId[]>();
  onLink?: (e: LinkEvent) => void;
  onSend?: (from: RobotId, to: RobotId | null, m: Msg) => void;

  private readonly positionOf: (id: RobotId) => Pos | null;

  constructor(opts: BusOpts, positionOf: (id: RobotId) => Pos | null) {
    this.opts = opts;
    this.positionOf = positionOf;
    this.rng = new Rng(opts.seed ^ 0xb05);
  }

  register(id: RobotId): Transport {
    this.queues.set(id, []);
    this.stats.set(id, { sent: 0, recv: 0, bytesSent: 0, bytesRecv: 0 });
    return {
      broadcast: (m) => this.transmit(id, null, m),
      send: (to, m) => this.transmit(id, to, m),
      poll: () => this.poll(id),
    };
  }

  /** Called once per tick before agents poll: refresh positions and the spatial hash. */
  setTime(t: number): void {
    this.t = t;
    this.hash.clear();
    const R = Math.max(1, this.opts.range);
    for (const id of this.queues.keys()) {
      const p = this.positionOf(id);
      this.pos.set(id, p);
      if (!p) continue;
      const k = this.key(Math.floor(p.x / R), Math.floor(p.y / R));
      const b = this.hash.get(k);
      if (b) b.push(id);
      else this.hash.set(k, [id]);
    }
  }

  private key(bx: number, by: number): number {
    return (bx + 1000) * 4096 + (by + 1000);
  }

  private silenced(p: Pos | null | undefined): boolean {
    return !p || this.opts.deadZones.some((z) => inRect(z, p.x, p.y));
  }

  private inRange(a: Pos, b: Pos): boolean {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy <= this.opts.range * this.opts.range;
  }

  private candidates(p: Pos): RobotId[] {
    const R = Math.max(1, this.opts.range);
    const bx = Math.floor(p.x / R), by = Math.floor(p.y / R);
    const out: RobotId[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const b = this.hash.get(this.key(bx + dx, by + dy));
        if (b) out.push(...b);
      }
    return out.sort((a, b) => a - b);
  }

  private transmit(from: RobotId, to: RobotId | null, m: Msg): void {
    const st = this.stats.get(from)!;
    const bytes = msgBytes(m);
    st.sent++;
    st.bytesSent += bytes;
    this.onSend?.(from, to, m);
    const p = this.pos.get(from);
    if (!p || this.silenced(p)) return;
    const targets = to === null ? this.candidates(p) : [to];
    for (const r of targets) {
      if (r === from) continue;
      const q = this.pos.get(r);
      if (!q || this.silenced(q) || !this.inRange(p, q)) continue;
      if (this.rng.next() < this.opts.loss) continue;
      const [a, b] = this.opts.latency;
      this.enqueue(r, { due: this.t + this.rng.int(a, b), msg: m });
    }
  }

  private enqueue(r: RobotId, e: Pending): void {
    const q = this.queues.get(r);
    if (!q) return;
    let i = q.length;
    while (i > 0 && q[i - 1].due > e.due) i--;
    q.splice(i, 0, e);
  }

  private poll(id: RobotId): Msg[] {
    const q = this.queues.get(id)!;
    if (!q.length || q[0].due > this.t) return [];
    let n = 0;
    while (n < q.length && q[n].due <= this.t) n++;
    const due = q.splice(0, n);
    // receiver inside a dead zone (or powered off) at delivery time hears nothing
    if (this.silenced(this.pos.get(id))) return [];
    const st = this.stats.get(id)!;
    const out: Msg[] = [];
    for (const e of due) {
      st.recv++;
      st.bytesRecv += msgBytes(e.msg);
      out.push(e.msg);
      this.onLink?.({ from: e.msg.from, to: id, t: this.t, type: e.msg.type });
    }
    return out;
  }
}
