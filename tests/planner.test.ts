import { describe, expect, it } from 'vitest';
import { Planner } from '../src/agent/planner.ts';
import { makePreset } from '../src/shared/maps.ts';
import { MOVE_TICKS, TURN180_TICKS, TURN90_TICKS } from '../src/shared/constants.ts';
import type { Grid } from '../src/shared/grid.ts';
import type { Dir } from '../src/shared/types.ts';
import { randomGrid } from './helpers.ts';

const TURN = [0, TURN90_TICKS, TURN180_TICKS, TURN90_TICKS];

/** Reference Dijkstra over (cell, heading) with O(n^2) selection. */
function refCost(g: Grid, s: number, hd: Dir, goal: number, blocked?: Uint8Array): number {
  const n = g.size * 4;
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  dist[s * 4 + hd] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (best < 0 || dist[i] < dist[best])) best = i;
    if (best < 0) return Infinity;
    if (best >> 2 === goal) return dist[best];
    done[best] = 1;
    const c = best >> 2, h = best & 3;
    for (let d = 0; d < 4; d++) {
      const m = g.nbr[c * 4 + d];
      if (m < 0 || blocked?.[m]) continue;
      const nd = dist[best] + MOVE_TICKS + TURN[(d - h + 4) & 3];
      if (nd < dist[m * 4 + d]) dist[m * 4 + d] = nd;
    }
  }
}

function pathCost(g: Grid, s: number, hd: Dir, path: number[]): number {
  let cost = 0, c = s, h = hd;
  for (const m of path) {
    expect(g.manhattan(c, m)).toBe(1);
    expect(g.passable(m)).toBe(true);
    const d = g.dirTo(c, m);
    cost += MOVE_TICKS + TURN[(d - h + 4) & 3];
    c = m;
    h = d;
  }
  return cost;
}

describe('A*', () => {
  it('matches reference Dijkstra on random grids', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = randomGrid(seed, 12, 9, 0.3);
      const p = new Planner(g);
      const free = [...Array(g.size).keys()].filter((c) => g.passable(c));
      const s = free[seed % free.length], goal = free[(seed * 7919) % free.length];
      const hd = (seed % 4) as Dir;
      const ref = refCost(g, s, hd, goal);
      const path = p.plan(s, hd, goal);
      if (ref === Infinity) expect(path).toBeNull();
      else {
        expect(path).not.toBeNull();
        expect(path![path!.length - 1] ?? s).toBe(goal);
        expect(pathCost(g, s, hd, path!)).toBeCloseTo(ref, 5);
      }
    }
  });

  it('respects blocked cells and fails gracefully', () => {
    const g = makePreset('default');
    const p = new Planner(g);
    const a = g.idx(1, 4), b = g.idx(28, 4);
    const direct = p.plan(a, 1, b)!;
    expect(direct.length).toBe(27);
    const blocked = new Uint8Array(g.size);
    blocked[g.idx(10, 4)] = 1;
    const detour = p.plan(a, 1, b, { blocked })!;
    expect(detour.includes(g.idx(10, 4))).toBe(false);
    expect(pathCost(g, a, 1, detour)).toBeCloseTo(refCost(g, a, 1, b, blocked), 5);
    blocked[b] = 1;
    expect(p.plan(a, 1, b, { blocked })).toBeNull();
    expect(p.plan(a, 1, g.idx(3, 2))).toBeNull(); // shelf
  });
});
