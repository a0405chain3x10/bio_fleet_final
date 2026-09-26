import { BioFleetAgent, type Agent, type AgentConfig } from '../agent/Agent.ts';
import { BaselineAgent } from '../baseline/BaselineAgent.ts';

export function createAgent(cfg: AgentConfig): Agent {
  return cfg.mode === 'baseline' ? new BaselineAgent(cfg) : new BioFleetAgent(cfg);
}
