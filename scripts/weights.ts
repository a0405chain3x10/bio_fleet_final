import { buildScenario } from '../src/experiments/scenarios.ts';
import { InlineRuntime } from '../src/runtime/InlineRuntime.ts';
import { Simulation } from '../src/runtime/Simulation.ts';
// usage: node scripts/weights.ts <preset-scenario> <robots> <seed> — learned model weights after a run
const rt = new InlineRuntime();
const sim = new Simulation(buildScenario({ name: process.argv[2], robots: +process.argv[3], fault: 'none' }, 'biofleet', +process.argv[4]), rt);
rt.initSync(sim.agentConfigs());
sim.runSync();
for (const a of rt.agents.slice(0, 5) as any[]) console.log(`r${a.id} n=${a.learner.samples} edges=${a.learner.edges.size} w=[${Array.from(a.learner.w as Float64Array).map((x: number) => x.toFixed(3)).join(', ')}] meanExtra=${(a.learner.extra.reduce((x: number, y: number) => x + y, 0) / a.learner.extra.length).toFixed(2)}`);
