import type { Action, Observation, RobotId, Task } from '../shared/types.ts';

export interface AgentParams {
  /** use learned edge costs (Edge-AI) — BioFleet only */
  learned: boolean;
  /** INTENT window length */
  window: number;
  /** periodic replan interval while moving (ticks) */
  replanEvery: number;
}

export const DEFAULT_PARAMS: AgentParams = { learned: true, window: 10, replanEvery: 20 };

export interface AgentConfig {
  id: RobotId;
  mode: 'biofleet' | 'baseline';
  /** static floor plan (ASCII) — prior map knowledge, no runtime state */
  map: string[];
  seed: number;
  params: AgentParams;
  /** preassigned mission tasks, executed in order (scenario S1–S3) */
  mission?: Task[];
  /** optional HMAC key for message signing (M10) */
  key?: string;
}

/** An agent sees only its Observation and returns only an Action. */
export interface Agent {
  step(o: Observation): Action;
}
