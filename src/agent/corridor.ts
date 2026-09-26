import type { Grid } from '../shared/grid.ts';
import type { CorridorMsg } from '../shared/messages.ts';
import type { Cell, Dir, RobotId, SensedRobot } from '../shared/types.ts';

const HOLDER_FRESH = 20;
const REQ_FRESH = 25;
const JOIN_GRACE = 8;

interface Holder {
  dir: number;
  t: number;
  /** sender's own clock at join (only compared with that sender's later stamps) */
  since: number;
}
interface Req {
  dir: number;
  prio: number;
  t: number;
}

/**
 * Local view of directional corridor locks, built only from CORRIDOR messages, heartbeats and,
 * when those are missing, onboard sensing. A lock is "held" in a direction while any holder is inside.
 */
export class CorridorTable {
  private g: Grid;
  /** neighbour toward higher / lower chain index (or the outside cell at the ends) */
  readonly plusNbr: Int32Array;
  readonly minusNbr: Int32Array;
  private holders = new Map<number, Map<RobotId, Holder>>();
  private reqs = new Map<number, Map<RobotId, Req>>();
  /** entry edges: from outside cell into an end cell, with the direction it implies */
  readonly entries: { cid: number; from: Cell; into: Cell; dir: number }[] = [];

  constructor(g: Grid) {
    this.g = g;
    this.plusNbr = new Int32Array(g.size).fill(-1);
    this.minusNbr = new Int32Array(g.size).fill(-1);
    for (const cor of g.corridors) {
      const cs = cor.cells;
      for (let i = 0; i < cs.length; i++) {
        const nb = this.chainNbrs(cs[i]);
        const prev = i > 0 ? cs[i - 1] : nb.find((n) => n !== cs[i + 1]) ?? -1;
        const next = i < cs.length - 1 ? cs[i + 1] : nb.find((n) => n !== prev) ?? -1;
        this.minusNbr[cs[i]] = prev;
        this.plusNbr[cs[i]] = next;
      }
      const a = cs[0], b = cs[cs.length - 1];
      if (this.minusNbr[a] >= 0) this.entries.push({ cid: cor.id, from: this.minusNbr[a], into: a, dir: 1 });
      if (this.plusNbr[b] >= 0) this.entries.push({ cid: cor.id, from: this.plusNbr[b], into: b, dir: -1 });
    }
  }

  private chainNbrs(c: Cell): Cell[] {
    const out: Cell[] = [];
    for (let d = 0; d < 4; d++) {
      const m = this.g.nbr[c * 4 + d];
      if (m >= 0 && this.g.type(m) !== 5) out.push(m);
    }
    return out;
  }

  cid(c: Cell): number {
    return c >= 0 ? this.g.corridorOf[c] : -1;
  }

  /** Direction of travel through corridor cell `c` when heading toward `to` (+1/-1, 0 unknown). */
  dirAt(c: Cell, to: Cell): number {
    if (to === this.plusNbr[c]) return 1;
    if (to === this.minusNbr[c]) return -1;
    return 0;
  }

  dirFromHeading(c: Cell, h: Dir): number {
    const m = this.g.nbr[c * 4 + h];
    return m < 0 ? 0 : this.dirAt(c, m);
  }

  /** Direction I will travel when entering corridor cell `c` from `from`, continuing to `after`. */
  entryDir(from: Cell, c: Cell, after: Cell): number {
    if (after >= 0 && this.cid(after) === this.cid(c)) return this.dirAt(c, after);
    if (from === this.minusNbr[c]) return 1;
    if (from === this.plusNbr[c]) return -1;
    return after >= 0 ? this.dirAt(c, after) : 0;
  }

  private map<T>(m: Map<number, Map<RobotId, T>>, cid: number): Map<RobotId, T> {
    let x = m.get(cid);
    if (!x) m.set(cid, (x = new Map()));
    return x;
  }

  onMsg(m: CorridorMsg, t: number): void {
    if (m.op === 'req') this.map(this.reqs, m.corridorId).set(m.from, { dir: m.direction, prio: m.priority, t });
    else if (m.op === 'join') {
      this.map(this.holders, m.corridorId).set(m.from, { dir: m.direction, t, since: m.t });
      this.reqs.get(m.corridorId)?.delete(m.from);
    } else {
      this.holders.get(m.corridorId)?.delete(m.from);
      this.reqs.get(m.corridorId)?.delete(m.from);
    }
  }

  /** Heartbeats refresh or clear holder state; `sentAt` is the sender's clock. */
  onPosition(id: RobotId, cell: Cell, heading: Dir, t: number, sentAt: number): void {
    const cid = this.cid(cell);
    for (const [k, hs] of this.holders) {
      const h = hs.get(id);
      // a join precedes physically entering: only a later heartbeat outside proves it left
      if (k !== cid && h && sentAt > h.since + JOIN_GRACE) hs.delete(id);
    }
    if (cid < 0) return;
    const d = this.dirFromHeading(cell, heading);
    const cur = this.map(this.holders, cid).get(id);
    this.map(this.holders, cid).set(id, { dir: d || cur?.dir || 0, t, since: cur?.since ?? sentAt });
    this.reqs.get(cid)?.delete(id);
  }

  forget(id: RobotId): void {
    for (const hs of this.holders.values()) hs.delete(id);
    for (const rs of this.reqs.values()) rs.delete(id);
  }

  /** Why I may not enter corridor `cid` in `dir` now, or null if I may. */
  conflict(cid: number, dir: number, me: RobotId, prio: number, t: number, sensed: SensedRobot[]): string | null {
    for (const [id, h] of this.holders.get(cid) ?? []) {
      if (id === me || t - h.t > HOLDER_FRESH) continue;
      if (h.dir !== dir) return `corridor:held-by-${id}`;
    }
    for (const [id, r] of this.reqs.get(cid) ?? []) {
      if (id === me || t - r.t > REQ_FRESH) continue;
      if (r.dir !== dir && r.prio > prio) return `corridor:req-${id}`;
    }
    for (const r of sensed) {
      const inside = this.cid(r.cell) === cid ? r.cell : this.cid(r.to) === cid ? r.to : -1;
      if (inside < 0) continue;
      if (this.sensedDir(r, cid) !== dir) return `corridor:sensed-${r.id}`;
    }
    return null;
  }

  private sensedDir(r: SensedRobot, cid: number): number {
    if (r.to < 0) return this.dirFromHeading(r.cell, r.heading);
    if (this.cid(r.to) !== cid) return this.dirAt(r.cell, r.to);
    return r.cell === this.minusNbr[r.to] ? 1 : r.cell === this.plusNbr[r.to] ? -1 : 0;
  }

  /** Opposite-direction occupancy estimate (ticks to clear) for planning costs. */
  opposingLoad(cid: number, dir: number, t: number): number {
    let n = 0;
    for (const h of this.holders.get(cid)?.values() ?? []) if (t - h.t <= HOLDER_FRESH && h.dir !== dir) n++;
    return n;
  }

  holdersOf(cid: number, t: number): { id: RobotId; dir: number }[] {
    const out: { id: RobotId; dir: number }[] = [];
    for (const [id, h] of this.holders.get(cid) ?? []) if (t - h.t <= HOLDER_FRESH) out.push({ id, dir: h.dir });
    return out;
  }
}
