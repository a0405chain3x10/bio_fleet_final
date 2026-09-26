import { buildScenario, MATRIX } from './experiments/scenarios.ts';
import { InlineRuntime } from './runtime/InlineRuntime.ts';
import { Simulation } from './runtime/Simulation.ts';
for (const mode of (process.argv[2] ?? 'baseline,biofleet').split(',') as ('baseline'|'biofleet')[])
for (const spec of MATRIX) {
  const rt = new InlineRuntime();
  const sim = new Simulation(buildScenario(spec, mode, 1), rt);
  rt.initSync(sim.agentConfigs());
  const t0 = performance.now();
  sim.runSync();
  const s = sim.metrics.summary(sim.world);
  console.log(mode, spec.name, spec.robots, JSON.stringify(s), (performance.now() - t0).toFixed(0) + 'ms');
}
