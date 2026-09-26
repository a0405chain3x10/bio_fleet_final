import type { Agent, AgentConfig } from '../agent/contracts.ts';
import type { Action, Observation } from '../shared/types.ts';
import { createAgent } from './agentFactory.ts';
import type { AgentRuntime } from './Runtime.ts';

/** All agents in the calling thread — fast headless experiments. */
export class InlineRuntime implements AgentRuntime {
  readonly name = 'inline';
  agents: Agent[] = [];
  async init(cfgs: AgentConfig[]): Promise<void> {
    this.initSync(cfgs);
  }
  initSync(cfgs: AgentConfig[]): void {
    this.agents = cfgs.map(createAgent);
  }
  async step(obs: (Observation | null)[]): Promise<(Action | undefined)[]> {
    return this.stepSync(obs);
  }
  stepSync(obs: (Observation | null)[]): (Action | undefined)[] {
    return obs.map((o, i) => (o ? this.agents[i].step(o) : undefined));
  }
  dispose(): void {
    this.agents = [];
  }
}
