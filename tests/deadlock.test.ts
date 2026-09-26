import { describe, expect, it } from 'vitest';
import { onProbe } from '../src/agent/deadlock.ts';
import { runOne } from '../src/experiments/runner.ts';
import type { ProbeMsg } from '../src/shared/messages.ts';

const probe = (p: Partial<ProbeMsg>): ProbeMsg => ({ type: 'PROBE', from: 0, seq: 0, t: 0, initiator: 0, path: [0], prios: [5], ...p });

describe('PROBE edge chasing', () => {
  it('forwards along the wait-for edge and detects a 3-cycle; lowest priority is the victim', () => {
    // 0 waits on 1, 1 waits on 2, 2 waits on 0
    const a = onProbe(1, 9, 2, probe({}));
    expect(a).toEqual({ kind: 'forward', to: 2, path: [0, 1], prios: [5, 9] });
    const b = onProbe(2, 3, 0, probe({ path: [0, 1], prios: [5, 9] }));
    expect(b.kind).toBe('forward');
    const c = onProbe(0, 5, 1, probe({ path: [0, 1, 2], prios: [5, 9, 3] }));
    expect(c).toEqual({ kind: 'cycle', victim: 2, members: [0, 1, 2] });
  });
  it('drops probes when not waiting, and victims retreat', () => {
    expect(onProbe(1, 9, -1, probe({})).kind).toBe('none');
    expect(onProbe(2, 1, -1, probe({ victim: 2 })).kind).toBe('retreat');
  });
});

describe('dense preset, 20 robots (M7)', () => {
  it('no robot stuck longer than 15 s, all tasks done, 0 collisions', () => {
    for (const seed of [1, 2, 3]) {
      const r = runOne({ name: 'S4:dense', robots: 20, fault: 'none' }, 'biofleet', seed);
      expect(r.collisions).toBe(0);
      expect(r.complete).toBe(true);
      expect(r.maxStuckSec).toBeLessThanOrEqual(15);
    }
  });
});
