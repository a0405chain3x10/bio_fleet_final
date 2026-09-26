import { MOVE_TICKS, TURN180_TICKS, TURN90_TICKS } from '../shared/constants.ts';
import { DistanceCache, type Grid } from '../shared/grid.ts';
import type { Cell, Dir } from '../shared/types.ts';

export interface PlanOpts {
  blocked?: Uint8Array;
  /** extra ticks for entering along edge (cell*4+dir) */
  edgeExtra?: Float32Array;
  /** extra ticks for entering a cell */
  cellPenalty?: Float32Array;
  maxIter?: number;
}

const TURN_COST = [0, TURN90_TICKS, TURN180_TICKS, TURN90_TICKS];

/** A* over (cell, heading) with exact turn costs; typed arrays, generation stamps, no allocation in the loop. */
export class Planner {
  readonly grid: Grid;
  readonly dists: DistanceCache;
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Int32Array;
  private closed: Int32Array;
  private gen = 0;
  private heap: Int32Array;
  private key: Float32Array;
  private hn = 0;
  lastExpanded = 0;

  constructor(grid: Grid) {
    this.grid = grid;
    this.dists = new DistanceCache(grid);
    const n = grid.size * 4;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.heap = new Int32Array(n * 4);
    this.key = new Float32Array(n * 4);
  }

  /** Returns cells to traverse (excluding start), [] if already there, null if unreachable. */
  plan(start: Cell, heading: Dir, goal: Cell, o: PlanOpts = {}): Cell[] | null {
    if (start === goal) return [];
    const grid = this.grid;
    if (goal < 0 || !grid.passable(goal) || o.blocked?.[goal]) return null;
    const h = this.dists.get(goal);
    if (h[start] < 0) return null;
    const gen = ++this.gen;
    const g = this.g, from = this.from, stamp = this.stamp, closed = this.closed, nbr = grid.nbr;
    const maxIter = o.maxIter ?? grid.size * 8;
    this.hn = 0;
    const s0 = start * 4 + heading;
    g[s0] = 0;
    from[s0] = -1;
    stamp[s0] = gen;
    this.push(s0, h[start] * MOVE_TICKS);
    let iter = 0;
    while (this.hn > 0 && iter++ < maxIter) {
      const s = this.pop();
      if (closed[s] === gen) continue;
      closed[s] = gen;
      const c = s >> 2, hd = s & 3;
      if (c === goal) return this.reconstruct(s);
      const gs = g[s];
      for (let d = 0; d < 4; d++) {
        const m = nbr[c * 4 + d];
        if (m < 0 || (o.blocked && o.blocked[m])) continue;
        const hm = h[m];
        if (hm < 0) continue;
        let cost = MOVE_TICKS + TURN_COST[(d - hd + 4) & 3];
        if (o.edgeExtra) cost += o.edgeExtra[c * 4 + d];
        if (o.cellPenalty) cost += o.cellPenalty[m];
        const ns = m * 4 + d;
        const ng = gs + cost;
        if (stamp[ns] === gen && ng >= g[ns]) continue;
        stamp[ns] = gen;
        g[ns] = ng;
        from[ns] = s;
        this.push(ns, ng + hm * MOVE_TICKS);
      }
    }
    this.lastExpanded = iter;
    return null;
  }

  private reconstruct(s: number): Cell[] {
    const out: Cell[] = [];
    while (this.from[s] >= 0) {
      out.push(s >> 2);
      s = this.from[s];
    }
    return out.reverse();
  }

  private push(s: number, k: number): void {
    const heap = this.heap, key = this.key;
    let i = this.hn++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[p] <= k) break;
      heap[i] = heap[p];
      key[i] = key[p];
      i = p;
    }
    heap[i] = s;
    key[i] = k;
  }

  private pop(): number {
    const heap = this.heap, key = this.key;
    const top = heap[0];
    const n = --this.hn;
    const ls = heap[n], lk = key[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && key[c + 1] < key[c]) c++;
      if (key[c] >= lk) break;
      heap[i] = heap[c];
      key[i] = key[c];
      i = c;
    }
    heap[i] = ls;
    key[i] = lk;
    return top;
  }
}
