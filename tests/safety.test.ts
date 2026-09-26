import { describe, expect, it } from 'vitest';
import { checkMove } from '../src/agent/safety.ts';
import { Rng } from '../src/shared/rng.ts';
import type { Action, Dir, Observation } from '../src/shared/types.ts';
import { World } from '../src/world/World.ts';
import { randomGrid } from './helpers.ts';

/** Random-walk agent that uses ONLY the two-phase indicator rule. */
function randomAgent(o: Observation, w: World, rng: Rng, want: Int32Array): Action {
  const s = o.self;
  const g = w.grid; // map knowledge only (static layout)
  if (s.busy) return { kind: 'wait', indicator: s.moving ? -1 : want[s.id], outbox: [] };
  let tgt = want[s.id];
  if (tgt < 0 || g.manhattan(tgt, s.cell) !== 1 || rng.next() < 0.08) {
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) {
      const m = g.nbr[s.cell * 4 + d];
      if (m >= 0) opts.push(m);
    }
    tgt = opts.length ? rng.pick(opts) : -1;
    want[s.id] = tgt;
  }
  if (tgt < 0) return { kind: 'wait', indicator: -1, outbox: [] };
  const d = g.dirTo(s.cell, tgt) as Dir;
  if (d !== s.heading) return { kind: 'turn', dir: d, indicator: tgt, outbox: [] };
  return checkMove(o, tgt) === 'go'
    ? { kind: 'move', dir: d, indicator: tgt, outbox: [] }
    : { kind: 'wait', indicator: tgt, outbox: [] };
}

function runSeed(seed: number, ticks: number): { collisions: number; moved: number } {
  const rng = new Rng(seed);
  const g = randomGrid(seed, rng.int(8, 16), rng.int(6, 12), rng.next() * 0.3);
  const w = new World(g);
  const free = rng.shuffle([...Array(g.size).keys()].filter((c) => g.passable(c)));
  const n = Math.min(rng.int(2, 20), free.length - 1);
  for (let i = 0; i < n; i++) w.addRobot(free[i], rng.int(0, 3) as Dir);
  // random runtime obstacles too
  for (let i = n; i < n + 3 && i < free.length; i++) w.setObstacle(free[i], true);
  const want = new Int32Array(n).fill(-1);
  const actions: Action[] = new Array(n);
  for (let t = 0; t < ticks; t++) {
    // robots die (frozen, LED off, possibly mid-move) and come back
    if (rng.next() < 0.002) {
      const b = w.bodies[rng.int(0, n - 1)];
      if (b.alive) w.kill(b.id);
      else w.revive(b.id);
    }
    for (let i = 0; i < n; i++) actions[i] = randomAgent(w.observe(i, []), w, rng, want);
    w.step(actions);
  }
  return { collisions: w.collisions.count, moved: w.bodies.reduce((a, b) => a + b.cellsMoved, 0) };
}

describe('two-phase safety protocol (property)', () => {
  it('0 collisions: random maps, 2–20 agents, 10,000 ticks, 200 seeds', () => {
    let collisions = 0, moved = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = runSeed(seed, 10_000);
      collisions += r.collisions;
      moved += r.moved;
    }
    expect(collisions).toBe(0);
    expect(moved).toBeGreaterThan(100_000); // robots actually moved
  });

  it('negative control: skipping the rule does collide', () => {
    const g = randomGrid(3, 6, 4, 0);
    const w = new World(g);
    w.addRobot(g.idx(0, 0), 1);
    w.addRobot(g.idx(2, 0), 3);
    const mv = (d: Dir): Action => ({ kind: 'move', dir: d, indicator: g.idx(1, 0), outbox: [] });
    w.step([mv(1), mv(3)]);
    expect(w.collisions.count).toBeGreaterThan(0);
  });
});
