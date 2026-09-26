import type { Agent, AgentConfig } from '../agent/contracts.ts';
import type { Action, Observation } from '../shared/types.ts';
import { createAgent } from './agentFactory.ts';

export type ToWorker = { type: 'init'; cfg: AgentConfig } | { type: 'step'; obs: Observation };
export type FromWorker = { type: 'ready' } | { type: 'action'; action: Action };

/** Pure message handler so the worker body is testable without a browser. */
export function createWorkerHandler(): (m: ToWorker) => FromWorker {
  let agent: Agent | null = null;
  return (m) => {
    if (m.type === 'init') {
      agent = createAgent(m.cfg);
      return { type: 'ready' };
    }
    return { type: 'action', action: agent!.step(m.obs) };
  };
}
