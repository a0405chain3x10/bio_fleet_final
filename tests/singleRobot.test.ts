import { describe, expect, it } from 'vitest';
import { Planner } from '../src/agent/planner.ts';
import { makePreset } from '../src/shared/maps.ts';
import { CellType, type Action, type Observation } from '../src/shared/types.ts';
import { World } from '../src/world/World.ts';

/** Minimal scripted controller: plan, turn, move, pick, drop. */
function drive(o: Observation, p: Planner, goal: number, work: 'pick' | 'drop', taskId: string): Action {
  const s = o.self;
  if (s.busy) return { kind: 'wait', indicator: -1, outbox: [] };
  if (s.cell === goal) return { kind: work, taskId, indicator: -1, outbox: [] };
  const path = p.plan(s.cell, s.heading, goal)!;
  const d = p.grid.dirTo(s.cell, path[0]);
  return { kind: d === s.heading ? 'move' : 'turn', dir: d, indicator: path[0], outbox: [] };
}

describe('single robot', () => {
  it('completes pickup → drop in the default warehouse', () => {
    const g = makePreset('default');
    const w = new World(g);
    const p = new Planner(g);
    const pick = g.stations(CellType.PICKUP)[0], drop = g.stations(CellType.DROPOFF)[2];
    w.addRobot(g.idx(15, 17));
    w.releaseTask({ id: 't1', pickup: pick, drop, urgency: 1 });
    for (let i = 0; i < 2000 && w.tasksDone() === 0; i++) {
      const o = w.observe(0, []);
      const goal = o.self.carrying ? drop : pick;
      w.step([drive(o, p, goal, o.self.carrying ? 'drop' : 'pick', 't1')]);
    }
    expect(w.tasksDone()).toBe(1);
    expect(w.collisions.count).toBe(0);
    expect(w.bodies[0].battery).toBeLessThan(100);
  });
});
