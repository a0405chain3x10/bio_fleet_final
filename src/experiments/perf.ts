/** Perf gate: S4, 20 robots, 50 tasks, InlineRuntime, no rendering. Prints ms/tick p50/p95, agent ms/robot/tick and wall time. */
import { InlineRuntime } from '../runtime/InlineRuntime.ts';
import { Simulation } from '../runtime/Simulation.ts';
import { buildScenario } from './scenarios.ts';

const pct = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const seed = Number(process.argv[2] ?? 1);
for (const mode of ['biofleet', 'baseline'] as const) {
  const rt = new InlineRuntime();
  const sim = new Simulation(buildScenario({ name: 'S4', robots: 20, fault: 'none' }, mode, seed), rt);
  rt.initSync(sim.agentConfigs());
  const tick: number[] = [], agent: number[] = [];
  rt.stepSync = (obs) => obs.map((o, i) => {
    if (!o) return undefined;
    const a0 = performance.now();
    const a = rt.agents[i].step(o);
    agent.push(performance.now() - a0);
    return a;
  });
  const t0 = performance.now();
  while (!sim.done()) {
    const s = performance.now();
    sim.tickSync();
    tick.push(performance.now() - s);
  }
  const wall = (performance.now() - t0) / 1000;
  const s = sim.metrics.summary(sim.world);
  console.log(`${mode.padEnd(9)} ticks=${sim.world.t} tick ms p50=${pct(tick, 0.5).toFixed(3)} p95=${pct(tick, 0.95).toFixed(3)} | agent ms/robot/tick avg=${(agent.reduce((x, y) => x + y, 0) / agent.length).toFixed(3)} p95=${pct(agent, 0.95).toFixed(3)} | wall=${wall.toFixed(2)} s ${wall <= 5 ? 'OK' : 'OVER BUDGET (5 s)'} | done=${s.done}/${s.tasks} collisions=${s.collisions}`);
}
