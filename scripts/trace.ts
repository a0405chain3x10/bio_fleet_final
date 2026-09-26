import { buildScenario } from '../src/experiments/scenarios.ts';
import { InlineRuntime } from '../src/runtime/InlineRuntime.ts';
import { Simulation } from '../src/runtime/Simulation.ts';
const [name, n, mode, seed, until] = [process.argv[2], +process.argv[3], process.argv[4] as 'biofleet', +process.argv[5], +process.argv[6]];
const rt = new InlineRuntime();
const sim = new Simulation(buildScenario({ name, robots: n, fault: 'none' }, mode, seed), rt);
rt.initSync(sim.agentConfigs());
const g = sim.grid; const xy = (c: number) => c < 0 ? '-' : `${g.cx(c)},${g.cy(c)}`;
const prev = sim.world.bodies.map(b => b.cell);
while (sim.world.t < until) {
  sim.tickSync();
  for (const b of sim.world.bodies) {
    const cid = g.corridorOf[b.cell];
    if (b.cell !== prev[b.id] && cid >= 0 && g.corridorOf[prev[b.id]] !== cid) {
      const a = rt.agents[b.id] as any;
      console.log(`t=${sim.world.t} r${b.id} enters corridor ${cid} at ${xy(b.cell)} holders=${JSON.stringify(a.corridors.holdersOf(cid, sim.world.t))} reqs=${JSON.stringify([...(a.corridors.reqs.get(cid) ?? [])])} prio=${a.prio.value}`);
    }
    prev[b.id] = b.cell;
  }
}
