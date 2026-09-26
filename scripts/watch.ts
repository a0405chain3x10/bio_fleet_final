import { buildScenario, type FaultName } from '../src/experiments/scenarios.ts';
import { InlineRuntime } from '../src/runtime/InlineRuntime.ts';
import { Simulation } from '../src/runtime/Simulation.ts';
// usage: node scripts/watch.ts S2 4 biofleet 2 none <robot> <from> <to>
const [name, n, mode, seed, fault, who, from, to] = [process.argv[2], +process.argv[3], process.argv[4] as 'biofleet', +process.argv[5], process.argv[6] as FaultName, +process.argv[7], +process.argv[8], +process.argv[9]];
const rt = new InlineRuntime();
const sim = new Simulation(buildScenario({ name, robots: n, fault }, mode, seed), rt);
rt.initSync(sim.agentConfigs());
const g = sim.grid; const xy = (c: number) => c < 0 ? '-' : `${g.cx(c)},${g.cy(c)}`;
const orig = rt.stepSync.bind(rt);
rt.stepSync = (obs) => { const acts = orig(obs); const t = sim.world.t; if (t >= from && t <= to) { const a = acts[who]!; const tm = a.telemetry!; const o = obs[who]!;
  console.log(`t=${t} @${xy(o.self.cell)} busy=${o.self.busy} ${a.kind}${a.dir ?? ''} ind=${xy(a.indicator)} ${tm.state} wait=${tm.waitReason} plan=${tm.plan.slice(0, 4).map(xy).join(' ')} out=${a.outbox.map(x => x.msg.type).join(',')} in=${o.inbox.map(m => m.type[0] + m.from).join(',')}`); } return acts; };
while (sim.world.t <= to) sim.tickSync();
