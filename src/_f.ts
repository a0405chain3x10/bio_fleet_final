import { buildScenario } from './experiments/scenarios.ts';
import { InlineRuntime } from './runtime/InlineRuntime.ts';
import { Simulation } from './runtime/Simulation.ts';
const [name, n, mode, range] = [process.argv[2], +process.argv[3], process.argv[4] as 'baseline', +(process.argv[5] ?? 12)];
const rt = new InlineRuntime();
const cfg = buildScenario({ name, robots: n, fault: 'none' }, mode, 1);
cfg.bus = { ...cfg.bus, range };
const sim = new Simulation(cfg, rt);
rt.initSync(sim.agentConfigs());
const cnt: Record<string, number> = {};
let fails = 0;
while (!sim.done()) { sim.tickSync(); for (const t of sim.telemetry) if (t) cnt[t.state + (t.waitReason ? ':' + t.waitReason.split(':')[0] : '')] = (cnt[t.state + (t.waitReason ? ':' + t.waitReason.split(':')[0] : '')] ?? 0) + 1; for (const b of sim.world.bodies) if (b.lastWork === 'failed' && b.busy === 'none') fails++; }
console.log(JSON.stringify(sim.metrics.summary(sim.world)), JSON.stringify(cnt), 'failTicks', fails);
