import { buildScenario, type FaultName } from '../src/experiments/scenarios.ts';
import { InlineRuntime } from '../src/runtime/InlineRuntime.ts';
import { Simulation } from '../src/runtime/Simulation.ts';
// usage: node scripts/msgcount.ts S4:dense 20 biofleet <seed> — message mix + probe/retreat counts
const [name, n, mode, seed, fault] = [process.argv[2], +process.argv[3], process.argv[4] as 'biofleet', +process.argv[5], (process.argv[6] ?? 'none') as FaultName];
const rt = new InlineRuntime();
const sim = new Simulation(buildScenario({ name, robots: n, fault }, mode, seed), rt);
rt.initSync(sim.agentConfigs());
const cnt: Record<string, number> = {};
sim.bus.onSend = (_f, _t, m) => { const k = m.type + (m.type === 'PROBE' && m.victim !== undefined ? '(victim)' : ''); cnt[k] = (cnt[k] ?? 0) + 1; };
sim.runSync();
console.log(JSON.stringify(cnt), 'retreats', rt.agents.reduce((a, x: any) => a + (x.retreats ?? 0), 0));
