import { buildScenario, type FaultName } from '../src/experiments/scenarios.ts';
import { InlineRuntime } from '../src/runtime/InlineRuntime.ts';
import { Simulation } from '../src/runtime/Simulation.ts';
const [name, n, mode, seed, fault, ticks] = [process.argv[2], +process.argv[3], process.argv[4] as 'baseline', +process.argv[5], (process.argv[6] ?? 'none') as FaultName, +(process.argv[7] ?? 1e9)];
const rt = new InlineRuntime();
const sim = new Simulation(buildScenario({ name, robots: n, fault }, mode, seed), rt);
rt.initSync(sim.agentConfigs());
while (!sim.done() && sim.world.t < ticks) sim.tickSync();
const g = sim.grid; const xy = (c: number) => c < 0 ? '-' : `${g.cx(c)},${g.cy(c)}`;
console.log('t', sim.world.t, JSON.stringify(sim.metrics.summary(sim.world)), sim.faults.log.join(';'));
console.log('collisions', sim.world.collisions.recent.slice(0, 3).map(e => `${e.t}:${e.a}/${e.b}@${xy(e.cell)}`).join(' '));
for (const b of sim.world.bodies) { const t = sim.telemetry[b.id]!; console.log(b.id, b.alive ? '' : 'DEAD', xy(b.cell), 'h' + b.heading, b.busy, 'ind', xy(b.indicator), t?.state, 'goal', xy(t?.goal ?? -1), t?.waitReason, 'task', t?.taskId, 'path', t?.plan.slice(0, 3).map(xy).join(' '), 'bat', b.battery.toFixed(1), 'carry', b.carrying); }
const who = +(process.env.WHO ?? -1);
if (who >= 0) { const a = (rt.agents[who] as any); console.log('blocked', [...a.blocked].map(([c, b]: any) => `${xy(c)}:${b.src}:${b.until}`).join(' '), 'failed', [...a.failed.keys()].join(',')); }
