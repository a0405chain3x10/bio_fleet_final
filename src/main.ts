import { liveScenario } from './experiments/scenarios.ts';
import type { AgentRuntime } from './runtime/Runtime.ts';
import { InlineRuntime } from './runtime/InlineRuntime.ts';
import { Simulation, type SimConfig } from './runtime/Simulation.ts';
import { WorkerRuntime } from './runtime/WorkerRuntime.ts';
import { TICK_MS, TICKS_PER_SEC } from './shared/constants.ts';
import type { Grid } from './shared/grid.ts';
import { makePreset } from './shared/maps.ts';
import type { CellType } from './shared/types.ts';
import type { LinkEvent } from './transport/SimBus.ts';
import type { Rect } from './transport/Transport.ts';
import { DEFAULT_SETTINGS, mountControls, type Settings } from './ui/controls.ts';
import { Dashboard } from './ui/dashboard.ts';
import { attachEditor } from './ui/editor.ts';
import { mountExperiments, newExpWorker } from './ui/experiments.ts';
import { MessageLog } from './ui/log.ts';
import { Renderer } from './ui/renderer.ts';
import { validateMap } from './world/mapValidation.ts';

const $ = (id: string) => document.getElementById(id)!;

/** Browser app: owns the live Simulation, drives ticks at the chosen speed, renders, and feeds the dashboard. */
class App {
  s: Settings = { ...DEFAULT_SETTINGS };
  grid: Grid = makePreset(this.s.preset);
  sim: Simulation | null = null;
  rt: AgentRuntime | null = null;
  running = false;
  private stepping = false;
  private acc = 0;
  private last = performance.now();
  private lastUi = 0;
  private links: LinkEvent[] = [];
  private zones: Rect[] = [];
  private draft: Rect | null = null;
  private selected = 0;
  private heat = new Map<number, { heat: number[]; flow?: number[] }>();
  private shadow: { mode: string; makespan: number; complete: boolean } | null = null;
  private shadowWorker: Worker | null = null;
  private renderer = new Renderer($('world') as HTMLCanvasElement);
  private dash = new Dashboard($('metrics'), $('robots'));
  private log = new MessageLog();
  private ctl = mountControls($('controls'), this.s, {
    play: () => this.setRunning(true),
    pause: () => this.setRunning(false),
    step: () => void this.advance(1),
    reset: () => void this.reset(),
    preset: (p) => {
      this.grid = makePreset(p);
      void this.reset();
    },
    radio: () => this.applyRadio(),
    clearZones: () => {
      this.zones = [];
      this.applyRadio();
    },
    changed: () => void this.reset(),
  });

  constructor() {
    this.log.mount($('log'));
    this.dash.onSelect = (id) => (this.selected = id);
    attachEditor(this.renderer.canvas, this.renderer, {
      tool: () => this.s.tool,
      grid: () => this.grid,
      paint: (c, t: CellType) => {
        if (this.grid.type(c) !== t) this.grid.set(c, t);
      },
      paintDone: () => void this.reset(),
      toggleObstacle: (c) => {
        const w = this.sim?.world;
        if (w) w.setObstacle(c, !w.obstacle[c]);
      },
      addZone: (r) => {
        this.zones.push(r);
        this.applyRadio();
      },
      toggleRobot: (c) => {
        const b = this.sim?.world.bodies.find((x) => x.cell === c || (x.busy === 'move' && x.target === c));
        if (b) (b.alive ? this.sim!.world.kill(b.id) : this.sim!.world.revive(b.id));
      },
      select: (c) => {
        const b = this.sim?.world.bodies.find((x) => x.cell === c);
        if (b) this.selected = b.id;
      },
      setDraft: (r) => (this.draft = r),
    });
    requestAnimationFrame((t) => this.frame(t));
    void this.reset();
  }

  private bus() {
    return { latency: [this.s.latMin, Math.max(this.s.latMin, this.s.latMax)] as [number, number], loss: this.s.loss / 100, range: this.s.range, deadZones: this.zones };
  }

  private applyRadio(): void {
    if (this.sim) Object.assign(this.sim.bus.opts, this.bus());
  }

  private setRunning(r: boolean): void {
    this.running = r;
    this.ctl.setRunning(r);
    this.last = performance.now();
    this.acc = 0;
  }

  async reset(): Promise<void> {
    this.setRunning(false);
    const errs = validateMap(this.grid);
    const v = $('validation');
    v.classList.toggle('hidden', !errs.length);
    v.innerHTML = errs.map((e) => `⚠ ${e}`).join('<br>');
    this.rt?.dispose();
    this.sim = null;
    if (errs.length) return;
    const cfg = liveScenario(this.grid.toAscii(), {
      robots: this.s.robots, seed: this.s.seed, mode: this.s.mode, learned: this.s.learned,
      tasks: this.s.tasks, taskRate: this.s.taskMode === 'continuous' ? this.s.rate : 0, bus: this.bus(),
    });
    const rt: AgentRuntime = this.s.runtime === 'worker' ? WorkerRuntime.browser() : new InlineRuntime();
    const sim = new Simulation(cfg, rt);
    this.links = [];
    this.heat.clear();
    this.log.clear();
    this.log.setRobots(cfg.robots.length);
    sim.bus.onLink = (e) => {
      this.links.push(e);
      if (this.links.length > 400) this.links.splice(0, this.links.length - 400);
    };
    sim.bus.onSend = (from, to, m) => this.log.push(sim.world.t, from, to, m);
    await sim.init();
    this.rt = rt;
    this.sim = sim;
    this.selected = Math.min(this.selected, cfg.robots.length - 1);
    this.startShadow(cfg);
  }

  /** Same config, other mode, run headless in a worker → "% vs baseline" once both finish (batch mode). */
  private startShadow(cfg: SimConfig): void {
    this.shadowWorker?.terminate();
    this.shadow = null;
    if (cfg.taskRate) return;
    const other = cfg.mode === 'biofleet' ? 'baseline' : 'biofleet';
    const w = (this.shadowWorker = newExpWorker());
    w.onmessage = (e) => {
      this.shadow = { mode: other, ...e.data.shadow };
      w.terminate();
    };
    w.postMessage({ type: 'shadow', id: 0, cfg: { ...cfg, mode: other } });
  }

  private async advance(n: number): Promise<void> {
    const sim = this.sim;
    if (!sim || this.stepping) return;
    this.stepping = true;
    try {
      for (let i = 0; i < n && !sim.done(); i++) {
        if (sim.runtime.stepSync) sim.tickSync();
        else await sim.tick();
      }
      sim.telemetry.forEach((t, i) => t?.heat && this.heat.set(i, { heat: t.heat, flow: t.flow }));
      if (sim.done()) this.setRunning(false);
    } finally {
      this.stepping = false;
    }
  }

  private frame(now: number): void {
    const dt = Math.min(250, now - this.last);
    this.last = now;
    if (this.running && this.sim && !this.stepping) {
      this.acc += (dt * this.s.speed) / TICK_MS;
      const n = Math.min(Math.floor(this.acc), 40);
      if (n > 0) {
        this.acc -= n;
        void this.advance(n);
      }
    }
    this.draw();
    if (now - this.lastUi > 200) {
      this.lastUi = now;
      this.updateUi();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private draw(): void {
    const sim = this.sim;
    const h = this.heat.get(this.selected);
    this.renderer.render({
      grid: sim?.grid ?? this.grid, bodies: sim?.world.bodies ?? [], obstacle: sim?.world.obstacle ?? new Uint8Array(this.grid.size),
      telemetry: sim?.telemetry ?? [], deadZones: this.zones, links: this.links, t: sim?.world.t ?? 0,
      frac: this.running ? Math.min(0.99, this.acc) : 0, showHeat: this.s.heat, heat: h?.heat ?? null, flow: h?.flow ?? null,
      draft: this.draft, selected: this.selected,
    });
  }

  private updateUi(): void {
    const sim = this.sim;
    if (!sim) return;
    const w = sim.world, s = sim.metrics.summary(w);
    const n = w.bodies.length, secs = Math.max(1, w.t) / TICKS_PER_SEC;
    let sent = 0;
    for (const [id, st] of sim.bus.stats) if (id < 1000) sent += st.sent;
    let improvement = sim.cfg.taskRate ? 'n/a' : '…';
    if (this.shadow && s.complete) {
      const [bio, base] = sim.cfg.mode === 'biofleet' ? [s.makespan / TICKS_PER_SEC, this.shadow.makespan] : [this.shadow.makespan, s.makespan / TICKS_PER_SEC];
      improvement = `${(((base - bio) / base) * 100).toFixed(1)}%`;
    }
    this.dash.metrics({
      done: s.done, tasks: s.tasks, t: w.t, makespan: s.complete ? s.makespan / TICKS_PER_SEC : null, flowtime: s.flowtime,
      collisions: s.collisions, improvement, avgWait: s.waitTicks / TICKS_PER_SEC / Math.max(1, s.done), msgsPerRobotSec: sent / n / secs,
      planP50: sim.metrics.planPercentile(0.5), planP95: sim.metrics.planPercentile(0.95),
    });
    this.dash.robots(w.bodies, sim.telemetry, this.selected);
    this.log.render();
  }
}

function tabs(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${b.dataset.tab}`));
    }),
  );
}

tabs();
mountExperiments($('experiments'));
new App();
