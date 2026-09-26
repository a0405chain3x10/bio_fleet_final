import { InlineRuntime } from '../runtime/InlineRuntime.ts';
import { Simulation, type SimConfig } from '../runtime/Simulation.ts';
import { TICKS_PER_SEC } from '../shared/constants.ts';
import { runJob, type Job } from './runner.ts';

export type ExpRequest = { type: 'job'; id: number; job: Job } | { type: 'shadow'; id: number; cfg: SimConfig };

/** Headless experiment worker (InlineRuntime inside a worker so the UI stays responsive). */
const scope = self as unknown as { onmessage: (e: MessageEvent<ExpRequest>) => void; postMessage: (m: unknown) => void };
scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'job') {
    scope.postMessage({ id: m.id, result: runJob(m.job) });
    return;
  }
  const rt = new InlineRuntime();
  const sim = new Simulation(m.cfg, rt);
  rt.initSync(sim.agentConfigs());
  sim.runSync();
  const s = sim.metrics.summary(sim.world);
  scope.postMessage({ id: m.id, shadow: { complete: s.complete, makespan: s.makespan / TICKS_PER_SEC, collisions: s.collisions } });
};
