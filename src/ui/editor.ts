import type { Grid } from '../shared/grid.ts';
import { CellType } from '../shared/types.ts';
import type { Rect } from '../transport/Transport.ts';
import type { Tool } from './controls.ts';
import type { Renderer } from './renderer.ts';

export interface EditorHost {
  tool(): Tool;
  grid(): Grid;
  paint(cell: number, t: CellType): void;
  paintDone(): void;
  toggleObstacle(cell: number): void;
  addZone(r: Rect): void;
  toggleRobot(cell: number): void;
  select(cell: number): void;
  setDraft(r: Rect | null): void;
}

const PAINT: Partial<Record<Tool, CellType>> = {
  shelf: CellType.SHELF, pickup: CellType.PICKUP, dropoff: CellType.DROPOFF, charger: CellType.CHARGER,
  bay: CellType.BAY, eraser: CellType.FLOOR,
};

/** Canvas mouse interactions: map painting, runtime obstacles, dead-zone rectangles, kill/revive, selection. */
export function attachEditor(canvas: HTMLCanvasElement, r: Renderer, host: EditorHost): void {
  let drag: { x: number; y: number } | null = null;
  let painting = false;
  const rect = (a: { x: number; y: number }, g: Grid, c: number): Rect => {
    const x = g.cx(c), y = g.cy(c);
    return { x0: Math.min(a.x, x), y0: Math.min(a.y, y), x1: Math.max(a.x, x), y1: Math.max(a.y, y) };
  };
  canvas.addEventListener('mousedown', (e) => {
    const g = host.grid(), c = r.cellAt(g, e), tool = host.tool();
    if (c < 0) return;
    const t = PAINT[tool];
    if (t !== undefined) {
      painting = true;
      host.paint(c, t);
    } else if (tool === 'deadzone') drag = { x: g.cx(c), y: g.cy(c) };
    else if (tool === 'obstacle') host.toggleObstacle(c);
    else if (tool === 'kill') host.toggleRobot(c);
    else host.select(c);
  });
  canvas.addEventListener('mousemove', (e) => {
    const g = host.grid(), c = r.cellAt(g, e);
    if (c < 0) return;
    const t = PAINT[host.tool()];
    if (painting && t !== undefined) host.paint(c, t);
    if (drag) host.setDraft(rect(drag, g, c));
  });
  window.addEventListener('mouseup', (e) => {
    if (painting) {
      painting = false;
      host.paintDone();
    }
    if (!drag) return;
    const g = host.grid(), c = r.cellAt(g, e);
    if (c >= 0) host.addZone(rect(drag, g, c));
    drag = null;
    host.setDraft(null);
  });
}
