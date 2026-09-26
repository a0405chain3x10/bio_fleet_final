import { buildScenario } from './experiments/scenarios.ts';
import { InlineRuntime } from './runtime/InlineRuntime.ts';
import { Simulation } from './runtime/Simulation.ts';
const [name, n, mode, ticks] = [process.argv[2], +process.argv[3], process.argv[4] as 'baseline', +process.argv[5]];
const rt = new InlineRuntime();
const sim = new Simulation(buildScenario({ name, robots: n, fault: 'none' }, mode, 1), rt);
rt.initSync(sim.agentConfigs());
for (let i = 0; i < ticks; i++) sim.tickSync();
const g = sim.grid;
const xy = (c: number) => c < 0 ? '-' : `${g.cx(c)},${g.cy(c)}`;
for (const b of sim.world.bodies) { const t = sim.telemetry[b.id]!; const a = rt.agents[b.id] as any;
  console.log(b.id, xy(b.cell), 'h'+b.heading, b.busy, 'ind', xy(b.indicator), t.state, 'goal', xy(t.goal), t.waitReason, 'task', t.taskId, 'path', t.plan.slice(0,3).map(xy).join(' '), 'bat', b.battery.toFixed(0), 'tb', a.tasks.myState); }
console.log('done', sim.world.tasksDone());
