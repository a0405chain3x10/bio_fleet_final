import type { Grid } from '../shared/grid.ts';
import type { Msg } from '../shared/messages.ts';
import { Rng } from '../shared/rng.ts';
import type { Transport } from '../transport/Transport.ts';

export const ROGUE_ID = 900;

/**
 * Adversary on the radio: broadcasts false positions/intents with top priority, claims every task
 * it hears and grabs every corridor lock. It does not know the fleet key (signs with its own).
 */
export class RogueRobot {
  private io: Transport;
  private rng: Rng;
  private g: Grid;
  private seq = 0;
  private tasks = new Set<string>();
  sent = 0;

  constructor(g: Grid, io: Transport, seed: number) {
    this.g = g;
    this.io = io;
    this.rng = new Rng(seed ^ 0x40c);
  }

  tick(t: number): void {
    for (const m of this.io.poll()) if (m.type === 'TASK' || m.type === 'BID') this.tasks.add(m.type === 'TASK' ? m.id : m.taskId);
    const base = { from: ROGUE_ID, t, sig: 'forged' };
    const cell = () => {
      let c = -1;
      while (c < 0 || !this.g.passable(c)) c = this.rng.int(0, this.g.size - 1);
      return c;
    };
    const out: Msg[] = [
      { ...base, seq: this.seq++, type: 'HEARTBEAT', cell: cell(), heading: 1, battery: 100, state: 'toDrop', priority: 9e9, taskId: null, committed: [cell()] },
      { ...base, seq: this.seq++, type: 'INTENT', path: [cell(), cell(), cell()], priority: 9e9 },
    ];
    for (const id of this.tasks) out.push({ ...base, seq: this.seq++, type: 'LOCK', taskId: id, cost: -1e9, bidder: ROGUE_ID });
    if (t % 5 === 0)
      for (const c of this.g.corridors) out.push({ ...base, seq: this.seq++, type: 'CORRIDOR', corridorId: c.id, direction: 1, holders: [ROGUE_ID], priority: 9e9, op: 'join' });
    for (const m of out) this.io.broadcast(m);
    this.sent += out.length;
  }
}
