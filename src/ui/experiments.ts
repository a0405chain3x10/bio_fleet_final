import type { Chart } from 'chart.js';
import { toCsv } from '../experiments/csv.ts';
import { jobs, summarize, VARIANTS, type RunResult, type SummaryRow } from '../experiments/runner.ts';
import { MATRIX } from '../experiments/scenarios.ts';
import { barChart } from './charts.ts';

type Result = RunResult & { variant: string };
const specKey = (i: number): string => `${MATRIX[i].name}/${MATRIX[i].robots}r/${MATRIX[i].fault}`;

export function newExpWorker(): Worker {
  return new Worker(new URL('../experiments/exp.worker.ts', import.meta.url), { type: 'module' });
}

/** Experiments tab: headless scenario matrix on a worker pool, Chart.js mean ± std bars, CSV export. */
export function mountExperiments(el: HTMLElement): void {
  el.innerHTML = `<h3>Experiment matrix (headless, InlineRuntime in ${Math.min(4, navigator.hardwareConcurrency || 2)} workers)</h3>
    <div class="row" style="max-width:900px">
      <label>Seeds <input type="number" id="xseeds" value="10" min="1" max="50"></label>
      ${VARIANTS.map((v) => `<label><input type="checkbox" class="xvar" value="${v.label}" checked> ${v.label}</label>`).join('')}
      <button id="xall">all</button><button id="xnone">none</button><button id="xrun" class="on">Run</button>
      <button id="xcsv" disabled>Download runs CSV</button><button id="xsum" disabled>Download summary CSV</button></div>
    <div class="row" style="flex-wrap:wrap;max-width:1100px">${MATRIX.map((_, i) => `<label style="flex:0 0 190px"><input type="checkbox" class="xs" value="${i}" checked> ${specKey(i)}</label>`).join('')}</div>
    <div class="progress"><i id="xbar"></i></div><div id="xstatus" class="legend">idle</div>
    <div class="charts"><div class="chart-box"><canvas id="xc1"></canvas></div><div class="chart-box"><canvas id="xc2"></canvas></div></div>
    <div id="xtable"></div>`;
  const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const checks = () => [...el.querySelectorAll<HTMLInputElement>('.xs')];
  $('xall').onclick = () => checks().forEach((c) => (c.checked = true));
  $('xnone').onclick = () => checks().forEach((c) => (c.checked = false));
  let results: Result[] = [], rows: SummaryRow[] = [];
  const charts: Chart[] = [];
  const download = (name: string, text: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    a.click();
  };
  $('xcsv').onclick = () => download('biofleet-runs.csv', toCsv(results));
  $('xsum').onclick = () => download('biofleet-summary.csv', toCsv(rows));
  $('xrun').onclick = () => {
    const specs = checks().filter((c) => c.checked).map((c) => MATRIX[Number(c.value)]);
    const want = [...el.querySelectorAll<HTMLInputElement>('.xvar')].filter((c) => c.checked).map((c) => c.value);
    const list = jobs(specs, VARIANTS.filter((v) => want.includes(v.label)), Number($<HTMLInputElement>('xseeds').value));
    results = [];
    const t0 = performance.now();
    const pool = Array.from({ length: Math.min(4, navigator.hardwareConcurrency || 2) }, newExpWorker);
    let next = 0, done = 0;
    const feed = (w: Worker) => {
      if (next < list.length) w.postMessage({ type: 'job', id: next, job: list[next++] });
    };
    pool.forEach((w) => {
      w.onmessage = (e) => {
        results.push(e.data.result);
        done++;
        $('xbar').style.width = `${(100 * done) / list.length}%`;
        $('xstatus').textContent = `${done}/${list.length} runs · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
        if (done === list.length) {
          pool.forEach((x) => x.terminate());
          rows = summarize(results);
          show(rows);
          ($('xcsv') as HTMLButtonElement).disabled = ($('xsum') as HTMLButtonElement).disabled = false;
        } else feed(w);
      };
      feed(w);
    });
  };
  const show = (rs: SummaryRow[]) => {
    charts.splice(0).forEach((c) => c.destroy());
    const keys = [...new Set(rs.map((r) => r.key))], variants = [...new Set(rs.map((r) => r.variant))];
    const pick = (k: string, v: string) => rs.find((r) => r.key === k && r.variant === v);
    charts.push(barChart($('xc1'), 'Makespan (s), mean ± std', keys, variants.map((v) => ({
      label: v, values: keys.map((k) => pick(k, v)?.makespanMean ?? NaN), errors: keys.map((k) => pick(k, v)?.makespanStd ?? 0),
    })), 'seconds'));
    charts.push(barChart($('xc2'), 'Makespan reduction vs baseline (%)', keys, variants.filter((v) => v !== 'baseline').map((v) => ({
      label: v, values: keys.map((k) => pick(k, v)?.improvementPct ?? NaN),
    })), '%'));
    const f = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? '—' : x.toFixed(d));
    $('xtable').innerHTML = `<table><tr><th>scenario</th><th>variant</th><th>done</th><th>makespan s</th><th>±</th><th>vs baseline</th><th>collisions</th><th>max stuck s</th><th>avg wait s</th><th>msg/robot/s</th></tr>
      ${rs.map((r) => `<tr><td>${r.key}</td><td>${r.variant}</td><td>${r.completed}/${r.runs}</td><td>${f(r.makespanMean)}</td><td>${f(r.makespanStd)}</td>
      <td class="${(r.improvementPct ?? 0) >= 20 ? 'good' : ''}">${f(r.improvementPct)}%</td><td class="${r.collisions ? 'bad' : 'good'}">${r.collisions}</td>
      <td>${f(r.maxStuckSec)}</td><td>${f(r.avgWaitSec)}</td><td>${f(r.msgsPerRobotSec)}</td></tr>`).join('')}</table>`;
  };
}
