import type { Action, Observation } from '../shared/types.ts';
import { AgentCore } from './core.ts';

export type { Agent, AgentConfig, AgentParams } from './contracts.ts';
export { DEFAULT_PARAMS } from './contracts.ts';

/** BioFleet agent: core behaviour plus decentralized coordination (filled in from M5). */
export class BioFleetAgent extends AgentCore {
  protected navigate(o: Observation): Action {
    this.trimPath(o);
    if (!this.path.length || this.planGoal !== this.goal) this.replan(o, {});
    const next = this.path[0] ?? -1;
    if (o.self.moving) return { kind: 'wait', indicator: next, outbox: [] };
    if (next < 0) return { kind: 'wait', indicator: -1, outbox: [] };
    return this.stepInto(o, next).action;
  }
}
