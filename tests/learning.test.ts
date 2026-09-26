import { describe, expect, it } from 'vitest';
import { EdgeLearner } from '../src/agent/learning.ts';
import { Grid } from '../src/shared/grid.ts';
import { Rng } from '../src/shared/rng.ts';

describe('edge learner', () => {
  it('learns that density predicts delay (SGD) and raises predicted cost of crowded edges', () => {
    const g = new Grid(12, 8);
    const L = new EdgeLearner(g);
    const rng = new Rng(1);
    const crowd = [g.idx(5, 4), g.idx(6, 4), g.idx(5, 3)];
    for (let t = 0; t < 3000; t++) {
      L.rebuild(t % 2 ? crowd : [], 1, t);
      const e = g.idx(rng.int(1, 10), rng.int(1, 6)) * 4 + 1;
      const to = g.nbr[e];
      L.observe(e, L.density[to] * 4 + rng.next(), 1, t);
    }
    expect(L.w[1]).toBeGreaterThan(0.2);
    L.rebuild(crowd, 1, 3000);
    const busy = L.extra[g.idx(4, 4) * 4 + 1], empty = L.extra[g.idx(1, 1) * 4 + 1];
    expect(busy).toBeGreaterThan(empty + 2);
  });

  it('gossips sparse own estimates and merges them confidence-weighted', () => {
    const g = new Grid(6, 6);
    const a = new EdgeLearner(g), b = new EdgeLearner(g);
    for (let i = 0; i < 5; i++) a.observe(9, 20, 1, i);
    const msg = a.gossip();
    expect(msg.length).toBe(3);
    b.observe(9, 0, 1, 0);
    b.merge(msg, 10);
    const e = b.edges.get(9)!;
    expect(e.d).toBeGreaterThan(5);
    expect(e.d).toBeLessThan(20);
    expect(b.gossip().length).toBe(3); // own edge only
  });
});
