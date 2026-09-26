import type { Telemetry } from '../shared/types.ts';
import type { World } from '../world/World.ts';

const PLAN_SAMPLES = 4096;

/** Run metrics, derived from ground truth (World) and agent telemetry. Bounded memory. */
export class Metrics {
  waitTicks = 0;
  maxStuck = 0;
  private stuckSince: Int32Array;
  private lastCell: Int32Array;
  planSamples = new Float32Array(PLAN_SAMPLES);
  private planN = 0;

  constructor(n: number) {
    this.stuckSince = new Int32Array(n);
    this.lastCell = new Int32Array(n).fill(-1);
  }

  record(w: World, tel: (Telemetry | undefined)[]): void {
    for (const b of w.bodies) {
      const tm = tel[b.id];
      if (!b.alive || !tm) continue;
      if (tm.waitReason) this.waitTicks++;
      if (tm.planMs > 0) this.planSamples[this.planN++ % PLAN_SAMPLES] = tm.planMs;
      const resting = tm.goal === b.cell || tm.goal < 0 || tm.state === 'parked' || tm.state === 'charging';
      if (b.cell !== this.lastCell[b.id] || resting || b.busy === 'pick' || b.busy === 'drop') {
        this.lastCell[b.id] = b.cell;
        this.stuckSince[b.id] = w.t;
      } else this.maxStuck = Math.max(this.maxStuck, w.t - this.stuckSince[b.id]);
    }
  }

  planPercentile(p: number): number {
    const n = Math.min(this.planN, PLAN_SAMPLES);
    if (!n) return 0;
    const a = Array.from(this.planSamples.subarray(0, n)).sort((x, y) => x - y);
    return a[Math.min(n - 1, Math.floor(p * n))];
  }

  summary(w: World) {
    let flow = 0, done = 0, makespan = 0;
    for (const p of w.parcels.values())
      if (p.status === 'done') {
        done++;
        flow += p.doneAt - p.releasedAt;
        makespan = Math.max(makespan, p.doneAt);
      }
    const complete = done === w.parcels.size && done > 0;
    return {
      tasks: w.parcels.size, done, complete, makespan: complete ? makespan : w.t, flowtime: flow,
      collisions: w.collisions.count, waitTicks: this.waitTicks, maxStuck: this.maxStuck,
      duplicates: [...w.parcels.values()].reduce((a, p) => a + Math.max(0, p.deliveries - 1), 0),
    };
  }
}
