import { TICKS_PER_SEC } from '../shared/constants.ts';
import type { Telemetry } from '../shared/types.ts';
import type { Body } from '../world/physics.ts';
import { ROBOT_COLORS } from './renderer.ts';

export interface MetricsView {
  done: number;
  tasks: number;
  t: number;
  makespan: number | null;
  flowtime: number;
  collisions: number;
  improvement: string;
  avgWait: number;
  msgsPerRobotSec: number;
  planP50: number;
  planP95: number;
}

const fmt = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d) : '—');

/** Metrics strip + per-robot cards. Pure telemetry sink: reads, never writes simulation state. */
export class Dashboard {
  private metricsEl: HTMLElement;
  private robotsEl: HTMLElement;
  onSelect: (id: number) => void = () => {};

  constructor(metricsEl: HTMLElement, robotsEl: HTMLElement) {
    this.metricsEl = metricsEl;
    this.robotsEl = robotsEl;
    robotsEl.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.card');
      if (card) this.onSelect(Number(card.dataset.id));
    });
  }

  metrics(m: MetricsView): void {
    const item = (label: string, v: string, cls = '') => `<div class="metric ${cls}"><b>${v}</b><small>${label}</small></div>`;
    this.metricsEl.innerHTML = [
      item('time s', fmt(m.t / TICKS_PER_SEC)),
      item('tasks', `${m.done}/${m.tasks}`),
      item('makespan s', m.makespan === null ? '…' : fmt(m.makespan)),
      item('flowtime s', fmt(m.flowtime / TICKS_PER_SEC, 0)),
      item('collisions', String(m.collisions), `collisions ${m.collisions ? 'bad' : ''}`),
      item('vs baseline', m.improvement),
      item('avg wait s', fmt(m.avgWait)),
      item('msg/robot/s', fmt(m.msgsPerRobotSec)),
      item('plan ms p50/p95', `${fmt(m.planP50, 2)}/${fmt(m.planP95, 2)}`),
    ].join('');
  }

  robots(bodies: Body[], tel: (Telemetry | undefined)[], selected: number): void {
    this.robotsEl.innerHTML = bodies.map((b, i) => {
      const t = tel[i];
      const bat = Math.max(0, Math.min(100, b.battery));
      const col = bat < 25 ? 'var(--bad)' : bat < 50 ? 'var(--warn)' : 'var(--accent)';
      return `<div class="card ${b.alive ? '' : 'dead'}" data-id="${i}" style="--c:${ROBOT_COLORS[i % ROBOT_COLORS.length]};${i === selected ? 'outline:1px solid #fff' : ''}">
        <div class="top"><span>R${i}</span><span class="state">${b.alive ? t?.state ?? '—' : 'FAILED'}</span></div>
        <div class="bar"><i style="width:${bat}%;background:${col}"></i></div>
        <div class="kv"><span>battery</span><span>${bat.toFixed(0)}%</span>
        <span>task</span><span>${b.carrying ?? t?.taskId ?? '—'}</span>
        <span>priority</span><span>${t ? t.priority : '—'}</span>
        <span>waiting</span><span class="wait">${t?.waitReason || '—'}</span>
        <span>heard</span><span>${t?.neighbours ?? 0} peers</span></div></div>`;
    }).join('');
  }
}
