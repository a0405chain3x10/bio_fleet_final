import { DX, DY, type Grid } from '../shared/grid.ts';
import type { Cell, Dir } from '../shared/types.ts';

const NF = 5; // bias, density, ewma, flow alignment, task phase
const LR = 0.1;
const EWMA_A = 0.3;
const Y_SCALE = 20; // ticks
const FLOW_DECAY = 0.85;
const DENSITY_R = 3;
const GOSSIP_N = 16;
const MAX_CONF = 50;

interface EdgeStat {
  d: number; // EWMA extra delay (ticks)
  n: number; // confidence
  t: number; // last update
  own: boolean;
}

/**
 * On-device online traffic-cost model. A linear regressor (SGD) predicts the extra traversal delay
 * of an edge from local density, the edge's EWMA delay, flow alignment ("pheromone") and task
 * phase. It trains only on this robot's own measured traversals; EWMAs are gossiped sparsely.
 */
export class EdgeLearner {
  private g: Grid;
  readonly w = new Float64Array(NF);
  readonly edges = new Map<number, EdgeStat>();
  readonly density: Float32Array;
  readonly flowX: Float32Array;
  readonly flowY: Float32Array;
  readonly extra: Float32Array;
  samples = 0;
  private x = new Float64Array(NF);

  constructor(g: Grid) {
    this.g = g;
    this.density = new Float32Array(g.size);
    this.flowX = new Float32Array(g.size);
    this.flowY = new Float32Array(g.size);
    this.extra = new Float32Array(g.size * 4);
  }

  /** Neighbours' headings from heartbeats lay a decaying flow field. */
  deposit(c: Cell, h: Dir): void {
    this.flowX[c] += DX[h];
    this.flowY[c] += DY[h];
  }

  align(c: Cell, d: number): number {
    const fx = this.flowX[c], fy = this.flowY[c];
    return (fx * DX[d] + fy * DY[d]) / (Math.hypot(fx, fy) + 1);
  }

  private features(edge: number, phase: number): Float64Array {
    const c = edge >> 2, d = edge & 3;
    const to = this.g.nbr[edge];
    const x = this.x;
    x[0] = 1;
    x[1] = to >= 0 ? this.density[to] / 5 : 0;
    x[2] = (this.edges.get(edge)?.d ?? 0) / Y_SCALE;
    x[3] = to >= 0 ? this.align(to, d) : 0;
    x[4] = phase / 2;
    void c;
    return x;
  }

  private predict(x: Float64Array): number {
    let y = 0;
    for (let i = 0; i < NF; i++) y += this.w[i] * x[i];
    return y;
  }

  /** One own traversal: `extra` = ticks waited beyond nominal before entering the edge. */
  observe(edge: number, extra: number, phase: number, t: number): void {
    const x = this.features(edge, phase);
    const err = extra / Y_SCALE - this.predict(x);
    for (let i = 0; i < NF; i++) this.w[i] = Math.max(-5, Math.min(5, this.w[i] + LR * err * x[i]));
    this.samples++;
    const e = this.edges.get(edge);
    if (e) {
      e.d += EWMA_A * (extra - e.d);
      e.n = Math.min(MAX_CONF, e.n + 1);
      e.t = t;
      e.own = true;
    } else this.edges.set(edge, { d: extra, n: 1, t, own: true });
  }

  /** Recompute density from peer positions and the per-edge predicted extra delay. */
  rebuild(peerCells: Cell[], phase: number, t: number): void {
    const g = this.g;
    this.density.fill(0);
    for (const pc of peerCells) {
      const px = g.cx(pc), py = g.cy(pc);
      for (let y = Math.max(0, py - DENSITY_R); y <= Math.min(g.h - 1, py + DENSITY_R); y++)
        for (let x = Math.max(0, px - DENSITY_R); x <= Math.min(g.w - 1, px + DENSITY_R); x++) this.density[y * g.w + x]++;
    }
    for (let c = 0; c < g.size; c++) {
      this.flowX[c] *= FLOW_DECAY;
      this.flowY[c] *= FLOW_DECAY;
    }
    // only the edge-specific part feeds A*: bias and phase shift every edge equally
    const w = this.w;
    for (let e = 0; e < this.extra.length; e++) {
      if (g.nbr[e] < 0) continue;
      const x = this.features(e, phase);
      const st = this.edges.get(e);
      const ewma = st ? (st.d * st.n) / (st.n + 2) : 0;
      this.extra[e] = Math.max(0, Math.min(60, ewma + (w[1] * x[1] + w[3] * x[3]) * Y_SCALE));
    }
    for (const [k, s] of this.edges) if (t - s.t > 3000) this.edges.delete(k);
  }

  /** Sparse gossip: my most recently measured edges as (edge, delay×10, confidence) triples. */
  gossip(): number[] {
    const own = [...this.edges].filter(([, s]) => s.own).sort((a, b) => b[1].t - a[1].t).slice(0, GOSSIP_N);
    return own.flatMap(([k, s]) => [k, Math.round(s.d * 10), s.n]);
  }

  /** Confidence-weighted merge; others' evidence counts half. */
  merge(flat: number[], t: number): void {
    for (let i = 0; i + 2 < flat.length; i += 3) {
      const k = flat[i], d = flat[i + 1] / 10, n = flat[i + 2] * 0.5;
      const e = this.edges.get(k);
      if (!e) this.edges.set(k, { d, n, t, own: false });
      else {
        e.d = (e.d * e.n + d * n) / (e.n + n);
        e.n = Math.min(MAX_CONF, e.n + n);
        e.t = t;
      }
    }
  }

  /** Per-cell congestion (max predicted extra over incoming directions) for the heatmap. */
  heat(): number[] {
    const out = new Array<number>(this.g.size).fill(0);
    for (let e = 0; e < this.extra.length; e++) {
      const to = this.g.nbr[e];
      if (to >= 0 && this.extra[e] > out[to]) out[to] = Math.round(this.extra[e] * 10) / 10;
    }
    return out;
  }
}
