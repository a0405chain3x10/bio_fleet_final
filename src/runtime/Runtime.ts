import type { AgentConfig } from '../agent/contracts.ts';
import type { Action, Observation } from '../shared/types.ts';

/** Hosts agents. Same Observation → Action contract regardless of where the agent code runs. */
export interface AgentRuntime {
  readonly name: string;
  init(cfgs: AgentConfig[]): Promise<void>;
  step(obs: (Observation | null)[]): Promise<(Action | undefined)[]>;
  stepSync?(obs: (Observation | null)[]): (Action | undefined)[];
  dispose(): void;
}
