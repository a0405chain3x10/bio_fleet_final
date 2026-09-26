import { buildScenario, type FaultName } from '../src/experiments/scenarios.ts';
import { InlineRuntime } from '../src/runtime/InlineRuntime.ts';
import { Simulation } from '../src/runtime/Simulation.ts';
// usage: node scripts/stuck.ts S4:dense 20 biofleet <seed> [fault] — longest stuck episodes with their wait reasons
const [name, n, mode, seed, fault] = [process.argv[2], +process.argv[3], process.argv[4] as 'biofleet', +process.argv[5], (process.argv[6] ?? 'none') as FaultName];
const rt = new InlineRuntime();
const sim = new Simulation(buildScenario({ name, robots: n, fault }, mode, seed), rt);
rt.initSync(sim.agentConfigs());
const g = sim.grid; const xy = (c: number) => `${g.cx(c)},${g.cy(c)}`;
const since = new Map<number, { t: number; cell: number; reasons: Map<string, number> }>();
const eps: { id: number; from: number; len: number; cell: string; reasons: string }[] = [];
while (!sim.done()) {
  sim.tickSync();
  for (const b of sim.world.bodies) {
    const tm = sim.telemetry[b.id]; if (!tm) continue;
    const resting = tm.goal === b.cell || tm.state === 'parked' || tm.state === 'charging' || b.busy === 'pick' || b.busy === 'drop';
    const cur = since.get(b.id);
    if (!cur || cur.cell !== b.cell || resting) {
      if (cur && sim.world.t - cur.t > 100) eps.push({ id: b.id, from: cur.t, len: (sim.world.t - cur.t) / 10, cell: xy(cur.cell), reasons: [...cur.reasons].map(([k, v]) => `${k}x${v}`).join(' ') });
      since.set(b.id, { t: sim.world.t, cell: b.cell, reasons: new Map() });
    } else { const r = tm.waitReason.replace(/-?\d+$/, '') || tm.state; cur.reasons.set(r, (cur.reasons.get(r) ?? 0) + 1); }
  }
}
eps.sort((a, b) => b.len - a.len);
for (const e of eps.slice(0, 8)) console.log(`r${e.id} t=${e.from} ${e.len}s @${e.cell}: ${e.reasons}`);
