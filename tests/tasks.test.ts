import { describe, expect, it } from 'vitest';
import { TaskBook } from '../src/agent/tasks.ts';
import { runOne } from '../src/experiments/runner.ts';
import type { Msg } from '../src/shared/messages.ts';

/** Two task books wired back-to-back with 1-tick latency. */
function pair() {
  const q: { to: number; m: Msg }[] = [];
  const mk = (id: number) => {
    let seq = 0;
    return new TaskBook(id, (m) => q.push({ to: 1 - id, m: { ...m, from: id, seq: seq++, t: 0 } as Msg }));
  };
  const books = [mk(0), mk(1)];
  const deliver = (t: number) => {
    for (const { to, m } of q.splice(0)) {
      if (m.type === 'BID' || m.type === 'RELEASE' || m.type === 'LOCK') books[to].onAuction(m, t);
      else if (m.type === 'DONE') books[to].onDone(m.taskId);
    }
  };
  return { books, deliver };
}

const task = { type: 'TASK' as const, from: 1000, seq: 0, t: 0, id: 'A', pickup: 1, drop: 2, urgency: 1, hopTTL: 4 };

describe('CBAA task book', () => {
  it('lowest cost wins, loser releases, no double assignment', () => {
    const { books, deliver } = pair();
    for (const b of books) b.onTask(task, 0);
    const costs = [30, 12];
    for (let t = 1; t < 20; t++) {
      books.forEach((b, i) => b.tick(t, true, () => costs[i]));
      deliver(t);
    }
    expect(books[1].current?.id).toBe('A');
    expect(books[0].current).toBeNull();
    expect(books[0].entries.get('A')!.owner).toBe(1);
  });

  it('ties break by lower id', () => {
    const { books, deliver } = pair();
    for (const b of books) b.onTask(task, 0);
    for (let t = 1; t < 20; t++) {
      books.forEach((b) => b.tick(t, true, () => 10));
      deliver(t);
    }
    expect(books[0].current?.id).toBe('A');
    expect(books[1].current).toBeNull();
  });

  it('re-auctions once when ETA grows >30%, then waits 20 s', () => {
    const { books } = pair();
    const b = books[0];
    b.assign({ id: 'A', pickup: 1, drop: 2, urgency: 1 }, 0);
    b.lockEta = 100;
    expect(b.maybeReauction(10, 120)).toBe(false);
    expect(b.maybeReauction(20, 140)).toBe(true);
    expect(b.current).toBeNull();
    b.assign({ id: 'A', pickup: 1, drop: 2, urgency: 1 }, 30);
    b.lockEta = 100;
    expect(b.maybeReauction(40, 200)).toBe(false); // hysteresis
    expect(b.maybeReauction(230, 200)).toBe(true);
  });
});

describe('faults (M6)', () => {
  for (const fault of ['F3', 'F4'] as const)
    it(`${fault}: every task completes with 0 collisions`, () => {
      for (const seed of [1, 2]) {
        const r = runOne({ name: 'S4', robots: 10, fault }, 'biofleet', seed);
        expect(r.collisions).toBe(0);
        expect(r.complete).toBe(true);
        expect(r.duplicates).toBe(0);
      }
    });
});
