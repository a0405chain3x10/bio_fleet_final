import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/experiments/scenarios.ts';
import { InlineRuntime } from '../src/runtime/InlineRuntime.ts';
import { Simulation } from '../src/runtime/Simulation.ts';
import { WorkerRuntime, type WorkerLike } from '../src/runtime/WorkerRuntime.ts';
import { createWorkerHandler } from '../src/runtime/workerHandler.ts';

/** Worker stand-in: real structured-clone message passing over a MessageChannel, async like a Web Worker. */
function channelWorker(): WorkerLike {
  const { port1, port2 } = new MessageChannel();
  const handle = createWorkerHandler();
  port2.on('message', (m) => port2.postMessage(handle(m)));
  const w: WorkerLike = {
    postMessage: (m) => port1.postMessage(m),
    onmessage: null,
    terminate: () => { port1.close(); port2.close(); },
  };
  port1.on('message', (data) => w.onmessage?.({ data }));
  return w;
}

async function trace(rtKind: 'inline' | 'worker', mode: 'biofleet' | 'baseline', seed: number, ticks: number) {
  const cfg = buildScenario({ name: 'S4', robots: 5, fault: 'F1-10' }, mode, seed);
  const rt = rtKind === 'inline' ? new InlineRuntime() : new WorkerRuntime(channelWorker);
  const sim = new Simulation(cfg, rt);
  await sim.init();
  for (let i = 0; i < ticks; i++) await sim.tick();
  rt.dispose();
  return { trace: sim.trace, done: sim.world.tasksDone(), sent: [...sim.bus.stats.values()].reduce((a, s) => a + s.sent, 0) };
}

describe('determinism', () => {
  it('same seed → identical trace (inline twice)', async () => {
    const a = await trace('inline', 'biofleet', 7, 800);
    const b = await trace('inline', 'biofleet', 7, 800);
    expect(a).toEqual(b);
    const c = await trace('inline', 'biofleet', 8, 800);
    expect(c.trace).not.toBe(a.trace);
  });
  it('same seed → identical trace in InlineRuntime and WorkerRuntime', async () => {
    for (const mode of ['biofleet', 'baseline'] as const) {
      const a = await trace('inline', mode, 3, 600);
      const b = await trace('worker', mode, 3, 600);
      expect(b).toEqual(a);
      expect(a.sent).toBeGreaterThan(100);
    }
  });
});
