import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/experiments/scenarios.ts';
import { InlineRuntime } from '../src/runtime/InlineRuntime.ts';
import { Simulation } from '../src/runtime/Simulation.ts';

function run(fault: 'F5-rogue' | 'F5-rogue-signed', ticks: number) {
  const cfg = { ...buildScenario({ name: 'S4', robots: 10, fault }, 'biofleet', 1), maxTicks: ticks };
  const rt = new InlineRuntime();
  const sim = new Simulation(cfg, rt);
  rt.initSync(sim.agentConfigs());
  sim.runSync();
  const rejected = rt.agents.reduce((a, x) => a + (x as unknown as { rejected: number }).rejected, 0);
  return { s: sim.metrics.summary(sim.world), rejected, rogueSent: sim.rogue!.sent };
}

describe('rogue robot (M10)', () => {
  it('HMAC-signed fleet rejects forged messages and completes all tasks', () => {
    const r = run('F5-rogue-signed', 30000);
    expect(r.rogueSent).toBeGreaterThan(1000);
    expect(r.rejected).toBeGreaterThan(1000);
    expect(r.s.complete).toBe(true);
    expect(r.s.collisions).toBe(0);
  });
  it('without signing the rogue stalls the fleet — but safety still holds', () => {
    const r = run('F5-rogue', 3000);
    expect(r.s.done).toBeLessThan(10);
    expect(r.s.collisions).toBe(0);
  });
});
