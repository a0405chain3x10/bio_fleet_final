import type { AgentParams } from '../agent/contracts.ts';
import { InlineRuntime } from '../runtime/InlineRuntime.ts';
import { Simulation } from '../runtime/Simulation.ts';
import { TICKS_PER_SEC } from '../shared/constants.ts';
import { buildScenario, type Mode, type ScenarioSpec } from './scenarios.ts';

export interface RunResult {
  scenario: string;
  robots: number;
  fault: string;
  mode: Mode;
  learned: boolean;
  seed: number;
  complete: boolean;
  tasks: number;
  done: number;
  makespan: number;
  flowtime: number;
  collisions: number;
  avgWaitSec: number;
  maxStuckSec: number;
  msgsPerRobotSec: number;
  bytesPerRobotSec: number;
  planP50: number;
  planP95: number;
  duplicates: number;
  wallMs: number;
}

const now = (): number => performance.now();

/** One headless run (InlineRuntime, no rendering). */
export function runOne(spec: ScenarioSpec, mode: Mode, seed: number, params?: Partial<AgentParams>): RunResult {
  const cfg = buildScenario(spec, mode, seed, params);
  const rt = new InlineRuntime();
  const sim = new Simulation(cfg, rt);
  rt.initSync(sim.agentConfigs());
  const t0 = now();
  sim.runSync();
  const wallMs = now() - t0;
  const s = sim.metrics.summary(sim.world);
  const n = cfg.robots.length, secs = sim.world.t / TICKS_PER_SEC;
  let sent = 0, bytes = 0;
  for (const [id, st] of sim.bus.stats) if (id < 1000) {
    sent += st.sent;
    bytes += st.bytesSent;
  }
  return {
    scenario: spec.name, robots: n, fault: spec.fault, mode, learned: mode === 'biofleet' && (params?.learned ?? true), seed,
    complete: s.complete, tasks: s.tasks, done: s.done, makespan: s.makespan / TICKS_PER_SEC, flowtime: s.flowtime / TICKS_PER_SEC,
    collisions: s.collisions, avgWaitSec: s.waitTicks / TICKS_PER_SEC / Math.max(1, s.done), maxStuckSec: s.maxStuck / TICKS_PER_SEC,
    msgsPerRobotSec: sent / n / secs, bytesPerRobotSec: bytes / n / secs,
    planP50: sim.metrics.planPercentile(0.5), planP95: sim.metrics.planPercentile(0.95), duplicates: s.duplicates, wallMs,
  };
}

export interface Variant {
  mode: Mode;
  params?: Partial<AgentParams>;
  label: string;
}

export const VARIANTS: Variant[] = [
  { mode: 'baseline', label: 'baseline' },
  { mode: 'biofleet', params: { learned: true }, label: 'biofleet' },
  { mode: 'biofleet', params: { learned: false }, label: 'biofleet-static' },
];

export interface Job {
  spec: ScenarioSpec;
  variant: Variant;
  seed: number;
}

export function jobs(specs: ScenarioSpec[], variants: Variant[], seeds: number): Job[] {
  const out: Job[] = [];
  for (const spec of specs) for (const variant of variants) for (let s = 1; s <= seeds; s++) out.push({ spec, variant, seed: s });
  return out;
}

export const runJob = (j: Job): RunResult & { variant: string } => ({ ...runOne(j.spec, j.variant.mode, j.seed, j.variant.params), variant: j.variant.label });

export interface SummaryRow {
  key: string;
  variant: string;
  runs: number;
  completed: number;
  makespanMean: number;
  makespanStd: number;
  flowtimeMean: number;
  collisions: number;
  maxStuckSec: number;
  avgWaitSec: number;
  msgsPerRobotSec: number;
  planP95: number;
  improvementPct: number | null;
}

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const std = (a: number[]): number => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

export const scenarioKey = (r: { scenario: string; robots: number; fault: string }): string => `${r.scenario}/${r.robots}r/${r.fault}`;

/** Mean ± std per scenario × variant; % makespan improvement vs the baseline of the same scenario. */
export function summarize(results: (RunResult & { variant: string })[]): SummaryRow[] {
  const groups = new Map<string, (RunResult & { variant: string })[]>();
  for (const r of results) {
    const k = `${scenarioKey(r)}|${r.variant}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const rows: SummaryRow[] = [];
  for (const [k, rs] of groups) {
    const [key, variant] = k.split('|');
    const ms = rs.map((r) => r.makespan);
    rows.push({
      key, variant, runs: rs.length, completed: rs.filter((r) => r.complete).length,
      makespanMean: mean(ms), makespanStd: std(ms), flowtimeMean: mean(rs.map((r) => r.flowtime)),
      collisions: rs.reduce((a, r) => a + r.collisions, 0), maxStuckSec: Math.max(...rs.map((r) => r.maxStuckSec)),
      avgWaitSec: mean(rs.map((r) => r.avgWaitSec)), msgsPerRobotSec: mean(rs.map((r) => r.msgsPerRobotSec)),
      planP95: Math.max(...rs.map((r) => r.planP95)), improvementPct: null,
    });
  }
  for (const r of rows) {
    const b = rows.find((x) => x.key === r.key && x.variant === 'baseline');
    if (b && r.variant !== 'baseline') r.improvementPct = (100 * (b.makespanMean - r.makespanMean)) / b.makespanMean;
  }
  return rows;
}
