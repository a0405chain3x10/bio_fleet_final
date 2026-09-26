/** Headless experiment matrix → results/*.csv.  Usage: npm run bench -- [--seeds 10] [--variants baseline,biofleet] [--tag name] [--only S4/10] [--security] */
import { mkdirSync, writeFileSync } from 'node:fs';
import { toCsv } from './csv.ts';
import { jobs, runJob, summarize, VARIANTS } from './runner.ts';
import { MATRIX, SECURITY_MATRIX } from './scenarios.ts';

const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const seeds = Number(arg('seeds', '10'));
const want = arg('variants', VARIANTS.map((v) => v.label).join(',')).split(',');
const only = arg('only', '');
const tag = arg('tag', 'bench');
const base = process.argv.includes('--security') ? SECURITY_MATRIX : MATRIX;
const specs = only ? base.filter((s) => `${s.name}/${s.robots}/${s.fault}`.startsWith(only)) : base;
const list = jobs(specs, VARIANTS.filter((v) => want.includes(v.label)), seeds);

const t0 = performance.now();
const results = list.map((j, i) => {
  const r = runJob(j);
  if (i % 20 === 19) process.stdout.write(`  ${i + 1}/${list.length}\n`);
  return r;
});
const rows = summarize(results);
mkdirSync('results', { recursive: true });
writeFileSync(`results/${tag}-runs.csv`, toCsv(results));
writeFileSync(`results/${tag}-summary.csv`, toCsv(rows));
const f = (x: number | null, d = 1): string => (x === null ? '—' : x.toFixed(d));
console.log('scenario'.padEnd(20), 'variant'.padEnd(16), 'done', 'makespan(s)'.padStart(16), 'impr%'.padStart(7), 'coll', 'maxStuck', 'msg/r/s');
for (const r of rows)
  console.log(r.key.padEnd(20), r.variant.padEnd(16), `${r.completed}/${r.runs}`.padStart(5),
    `${f(r.makespanMean)}±${f(r.makespanStd)}`.padStart(15), f(r.improvementPct).padStart(7), String(r.collisions).padStart(4),
    f(r.maxStuckSec).padStart(8), f(r.msgsPerRobotSec).padStart(7));
console.log(`${results.length} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s → results/${tag}-*.csv`);
