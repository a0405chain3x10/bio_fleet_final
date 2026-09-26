import { TASK_HOP_TTL } from '../shared/constants.ts';
import type { Msg } from '../shared/messages.ts';
import { signMsg } from '../shared/hmac.ts';
import type { Cell, Task } from '../shared/types.ts';
import type { Transport } from '../transport/Transport.ts';
import type { World } from './World.ts';

export const STATION_ID_BASE = 1000;
const ADVERTISE_EVERY = 30;
const OWNER_QUIET = 50;

/**
 * A pickup station acting as a WMS terminal: it publishes TASK messages for parcels on its shelf
 * and re-advertises them while no owner is heard. It never assigns robots.
 */
export class Station {
  readonly id: number;
  readonly cell: Cell;
  private io: Transport;
  private seq = 0;
  private tasks: Task[] = [];
  private ownerHeard = new Map<string, number>();

  private key?: string;

  constructor(id: number, cell: Cell, io: Transport, key?: string) {
    this.id = id;
    this.cell = cell;
    this.io = io;
    this.key = key;
  }

  add(task: Task): void {
    this.tasks.push(task);
  }

  tick(w: World): void {
    const t = w.t;
    for (const m of this.io.poll()) this.hear(m, t);
    const due = (t + this.id) % ADVERTISE_EVERY === 0;
    for (const task of this.tasks) {
      const p = w.parcels.get(task.id);
      if (!p || p.status !== 'waiting') continue;
      const fresh = p.releasedAt === t;
      if (!fresh && (!due || t - (this.ownerHeard.get(task.id) ?? -1e9) < OWNER_QUIET)) continue;
      const m: Msg = {
        type: 'TASK', from: this.id, seq: this.seq++, t, id: task.id, pickup: task.pickup, drop: task.drop,
        urgency: task.urgency, hopTTL: TASK_HOP_TTL,
      };
      if (this.key) m.sig = signMsg(this.key, m);
      this.io.broadcast(m);
    }
    this.tasks = this.tasks.filter((k) => w.parcels.get(k.id)?.status !== 'done');
  }

  private hear(m: Msg, t: number): void {
    if (this.key && (m.sig?.length !== 32 || m.sig !== signMsg(this.key, m))) return;
    if (m.type === 'LOCK') this.ownerHeard.set(m.taskId, t);
    else if (m.type === 'RELEASE') this.ownerHeard.delete(m.taskId);
    else if (m.type === 'HEARTBEAT' && m.taskId) this.ownerHeard.set(m.taskId, t);
  }
}
