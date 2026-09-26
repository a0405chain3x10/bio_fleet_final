import { CELL_PX, MOVE_TICKS } from '../shared/constants.ts';
import { DX, DY, type Grid } from '../shared/grid.ts';
import { CellType, type Telemetry } from '../shared/types.ts';
import type { LinkEvent } from '../transport/SimBus.ts';
import type { Rect } from '../transport/Transport.ts';
import type { Body } from '../world/physics.ts';

export const ROBOT_COLORS = [
  '#58a6ff', '#3fb950', '#f0883e', '#d2a8ff', '#ff7b72', '#79c0ff', '#e3b341', '#56d364', '#ffa198', '#a5d6ff',
  '#f778ba', '#7ee787', '#ffab70', '#bc8cff', '#39c5cf', '#ffd33d', '#db61a2', '#8ddb8c', '#ff9492', '#b392f0',
];
const C = CELL_PX;
const STATION_STYLE: Partial<Record<CellType, [string, string]>> = {
  [CellType.PICKUP]: ['#0f3d24', 'P'], [CellType.DROPOFF]: ['#4a2a0c', 'D'],
  [CellType.CHARGER]: ['#3d3a0c', '⚡'], [CellType.BAY]: ['#0c2a4a', 'B'],
};

export interface RenderState {
  grid: Grid;
  bodies: Body[];
  obstacle: Uint8Array;
  telemetry: (Telemetry | undefined)[];
  deadZones: Rect[];
  links: LinkEvent[];
  t: number;
  /** fraction of the current tick elapsed, for smooth interpolation */
  frac: number;
  showHeat: boolean;
  heat: number[] | null;
  flow: number[] | null;
  draft: Rect | null;
  selected: number;
}

/** Canvas 2D renderer: cached static layer + per-frame dynamic layers. */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private stat = document.createElement('canvas');
  private statRev = -1;
  private statGrid: Grid | null = null;
  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  private drawStatic(g: Grid): void {
    this.stat.width = this.canvas.width = g.w * C;
    this.stat.height = this.canvas.height = g.h * C;
    const x = this.stat.getContext('2d')!;
    x.fillStyle = '#0d1117';
    x.fillRect(0, 0, g.w * C, g.h * C);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    for (let c = 0; c < g.size; c++) {
      const px = g.cx(c) * C, py = g.cy(c) * C, ty = g.type(c);
      if (ty === CellType.SHELF) {
        x.fillStyle = '#2b3440';
        x.fillRect(px + 1, py + 1, C - 2, C - 2);
        x.fillStyle = '#343f4d';
        x.fillRect(px + 4, py + 4, C - 8, C - 8);
        continue;
      }
      x.fillStyle = g.corridorOf[c] >= 0 ? '#131a22' : '#10151c';
      x.fillRect(px, py, C, C);
      const st = STATION_STYLE[ty];
      if (st) {
        x.fillStyle = st[0];
        x.fillRect(px + 2, py + 2, C - 4, C - 4);
        x.fillStyle = '#c9d1d9';
        x.font = 'bold 13px system-ui';
        x.fillText(st[1], px + C / 2, py + C / 2 + 1);
      }
    }
    x.strokeStyle = '#1b222c';
    x.lineWidth = 1;
    for (let i = 0; i <= g.w; i++) x.strokeRect(i * C, 0, 0, g.h * C);
    for (let j = 0; j <= g.h; j++) x.strokeRect(0, j * C, g.w * C, 0);
  }

  render(s: RenderState): void {
    const g = s.grid;
    if (this.statGrid !== g || this.statRev !== g.rev) {
      this.drawStatic(g);
      this.statGrid = g;
      this.statRev = g.rev;
    }
    const x = this.ctx;
    x.drawImage(this.stat, 0, 0);
    if (s.showHeat) this.drawHeat(s);
    this.drawCorridors(s);
    this.drawZones(s);
    this.drawObstacles(s);
    this.drawPlans(s);
    this.drawLinks(s);
    this.drawRobots(s);
  }

  private center(g: Grid, c: number): [number, number] {
    return [g.cx(c) * C + C / 2, g.cy(c) * C + C / 2];
  }

  /** Interpolated robot position. */
  pos(s: RenderState, b: Body): [number, number] {
    const [ax, ay] = this.center(s.grid, b.cell);
    if (b.busy !== 'move') return [ax, ay];
    const [bx, by] = this.center(s.grid, b.target);
    const p = b.alive ? Math.min(1, (MOVE_TICKS - b.remaining + s.frac) / MOVE_TICKS) : (MOVE_TICKS - b.remaining) / MOVE_TICKS;
    return [ax + (bx - ax) * p, ay + (by - ay) * p];
  }

  private drawHeat(s: RenderState): void {
    const g = s.grid, x = this.ctx;
    if (s.heat) {
      for (let c = 0; c < g.size; c++) {
        const v = s.heat[c];
        if (v < 0.3) continue;
        x.fillStyle = `rgba(248,81,73,${Math.min(0.6, v / 20)})`;
        x.fillRect(g.cx(c) * C, g.cy(c) * C, C, C);
      }
    }
    if (!s.flow) return;
    x.strokeStyle = 'rgba(210,168,255,.55)';
    x.lineWidth = 1.5;
    for (let c = 0; c < g.size; c++) {
      const d = s.flow[c];
      if (d < 0) continue;
      const [cx, cy] = this.center(g, c);
      const ex = cx + DX[d] * 9, ey = cy + DY[d] * 9;
      x.beginPath();
      x.moveTo(cx - DX[d] * 9, cy - DY[d] * 9);
      x.lineTo(ex, ey);
      x.lineTo(ex - DX[d] * 4 - DY[d] * 3, ey - DY[d] * 4 + DX[d] * 3);
      x.stroke();
    }
  }

  private drawCorridors(s: RenderState): void {
    const x = this.ctx, g = s.grid;
    const held = new Map<number, number>();
    s.telemetry.forEach((t, i) => {
      if (t?.corridor && s.bodies[i]?.alive) held.set(t.corridor.id, t.corridor.dir);
    });
    for (const [cid, dir] of held) {
      x.fillStyle = dir > 0 ? 'rgba(57,197,207,.22)' : dir < 0 ? 'rgba(247,120,186,.22)' : 'rgba(200,200,200,.15)';
      for (const c of g.corridors[cid]?.cells ?? []) x.fillRect(g.cx(c) * C, g.cy(c) * C, C, C);
    }
  }

  private drawZones(s: RenderState): void {
    const x = this.ctx;
    for (const z of [...s.deadZones, ...(s.draft ? [s.draft] : [])]) {
      const w = (z.x1 - z.x0 + 1) * C, h = (z.y1 - z.y0 + 1) * C;
      x.fillStyle = 'rgba(248,81,73,.12)';
      x.fillRect(z.x0 * C, z.y0 * C, w, h);
      x.strokeStyle = 'rgba(248,81,73,.7)';
      x.setLineDash([6, 4]);
      x.strokeRect(z.x0 * C + 1, z.y0 * C + 1, w - 2, h - 2);
      x.setLineDash([]);
      x.fillStyle = 'rgba(248,81,73,.8)';
      x.font = '10px system-ui';
      x.fillText('dead zone', z.x0 * C + 28, z.y0 * C + 9);
    }
  }

  private drawObstacles(s: RenderState): void {
    const x = this.ctx, g = s.grid;
    x.strokeStyle = '#f85149';
    x.lineWidth = 3;
    for (let c = 0; c < g.size; c++) {
      if (!s.obstacle[c]) continue;
      const px = g.cx(c) * C, py = g.cy(c) * C;
      x.fillStyle = '#3d1414';
      x.fillRect(px + 2, py + 2, C - 4, C - 4);
      x.beginPath();
      x.moveTo(px + 7, py + 7);
      x.lineTo(px + C - 7, py + C - 7);
      x.moveTo(px + C - 7, py + 7);
      x.lineTo(px + 7, py + C - 7);
      x.stroke();
    }
  }

  private drawPlans(s: RenderState): void {
    const x = this.ctx;
    x.lineWidth = 2;
    x.setLineDash([5, 5]);
    s.bodies.forEach((b, i) => {
      const t = s.telemetry[i];
      if (!b.alive || !t || !t.plan.length) return;
      x.strokeStyle = ROBOT_COLORS[i % ROBOT_COLORS.length] + (i === s.selected ? 'ff' : '99');
      x.beginPath();
      const [sx, sy] = this.pos(s, b);
      x.moveTo(sx, sy);
      for (const c of t.plan) x.lineTo(...this.center(s.grid, c));
      x.stroke();
    });
    x.setLineDash([]);
  }

  private drawLinks(s: RenderState): void {
    const x = this.ctx;
    x.lineWidth = 1;
    for (const l of s.links) {
      const age = s.t - l.t;
      const a = s.bodies[l.from], b = s.bodies[l.to];
      if (age > 10 || !a || !b) continue;
      x.strokeStyle = `rgba(88,166,255,${0.35 * (1 - age / 10)})`;
      x.beginPath();
      x.moveTo(...this.pos(s, a));
      x.lineTo(...this.pos(s, b));
      x.stroke();
    }
  }

  private drawRobots(s: RenderState): void {
    const x = this.ctx, g = s.grid;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    s.bodies.forEach((b, i) => {
      const [px, py] = this.pos(s, b);
      const col = b.alive ? ROBOT_COLORS[i % ROBOT_COLORS.length] : '#6e7681';
      if (b.alive && b.indicator >= 0 && b.busy !== 'move') {
        const [ix, iy] = this.center(g, b.indicator);
        x.strokeStyle = '#ffd33d';
        x.lineWidth = 2;
        x.beginPath();
        x.moveTo(px, py);
        x.lineTo(px + (ix - px) * 0.45, py + (iy - py) * 0.45);
        x.stroke();
      }
      x.fillStyle = col;
      x.beginPath();
      x.arc(px, py, C * 0.36, 0, Math.PI * 2);
      x.fill();
      if (i === s.selected) {
        x.strokeStyle = '#fff';
        x.lineWidth = 2;
        x.stroke();
      }
      const h = b.heading;
      x.fillStyle = '#0d1117';
      x.beginPath();
      x.moveTo(px + DX[h] * 13, py + DY[h] * 13);
      x.lineTo(px + DX[h] * 6 - DY[h] * 5, py + DY[h] * 6 + DX[h] * 5);
      x.lineTo(px + DX[h] * 6 + DY[h] * 5, py + DY[h] * 6 - DX[h] * 5);
      x.fill();
      x.font = 'bold 11px system-ui';
      x.fillText(String(b.id), px - DX[h] * 3, py - DY[h] * 3 + 1);
      if (b.carrying) {
        x.fillStyle = '#e3b341';
        x.fillRect(px + 6, py - 13, 7, 7);
      }
      if (!b.alive) {
        x.strokeStyle = '#f85149';
        x.lineWidth = 2;
        x.strokeRect(px - 12, py - 12, 24, 24);
      }
    });
  }

  /** Canvas pixel → cell index (or -1). */
  cellAt(g: Grid, ev: MouseEvent): number {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - r.left) / r.width) * g.w), y = Math.floor(((ev.clientY - r.top) / r.height) * g.h);
    return x < 0 || y < 0 || x >= g.w || y >= g.h ? -1 : g.idx(x, y);
  }
}
