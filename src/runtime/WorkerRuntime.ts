import type { AgentConfig } from '../agent/contracts.ts';
import type { Action, Observation } from '../shared/types.ts';
import type { AgentRuntime } from './Runtime.ts';
import type { FromWorker, ToWorker } from './workerHandler.ts';

export interface WorkerLike {
  postMessage(m: ToWorker): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  terminate(): void;
}

/** One worker per robot; one postMessage per robot per tick (observation in, action+outbox out). */
export class WorkerRuntime implements AgentRuntime {
  readonly name = 'worker';
  private workers: WorkerLike[] = [];
  private waiting: ((r: FromWorker) => void)[] = [];
  private spawn: () => WorkerLike;

  constructor(spawn: () => WorkerLike) {
    this.spawn = spawn;
  }

  static browser(): WorkerRuntime {
    return new WorkerRuntime(
      () => new Worker(new URL('./agent.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    );
  }

  private call(i: number, m: ToWorker): Promise<FromWorker> {
    return new Promise((res) => {
      this.waiting[i] = res;
      this.workers[i].postMessage(m);
    });
  }

  async init(cfgs: AgentConfig[]): Promise<void> {
    this.dispose();
    this.workers = cfgs.map((_, i) => {
      const w = this.spawn();
      w.onmessage = (e) => this.waiting[i]?.(e.data);
      return w;
    });
    await Promise.all(cfgs.map((cfg, i) => this.call(i, { type: 'init', cfg })));
  }

  async step(obs: (Observation | null)[]): Promise<(Action | undefined)[]> {
    const replies = await Promise.all(obs.map((o, i) => (o ? this.call(i, { type: 'step', obs: o }) : null)));
    return replies.map((r) => (r && r.type === 'action' ? r.action : undefined));
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.waiting = [];
  }
}
