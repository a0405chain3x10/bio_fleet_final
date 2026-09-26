import { CellType, type Cell, type Dir } from './types.ts';

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export interface Corridor {
  id: number;
  /** ordered chain; direction +1 = cells[0] → cells[last] */
  cells: Cell[];
}

const CHARS: Record<string, CellType> = {
  '.': CellType.FLOOR, '#': CellType.SHELF, P: CellType.PICKUP, D: CellType.DROPOFF,
  C: CellType.CHARGER, B: CellType.BAY, X: CellType.OBSTACLE,
};
const REV = ['.', '#', 'P', 'D', 'C', 'B', 'X'];

/** Static floor plan. Runtime obstacles live in the World, not here. */
export class Grid {
  readonly w: number;
  readonly h: number;
  readonly cells: Uint8Array;
  /** nbr[c*4+d] = neighbouring passable cell or -1 */
  nbr!: Int32Array;
  corridors: Corridor[] = [];
  corridorOf!: Int16Array;
  private version = 0;

  constructor(w: number, h: number, cells?: Uint8Array) {
    this.w = w;
    this.h = h;
    this.cells = cells ?? new Uint8Array(w * h);
    this.rebuild();
  }

  static fromAscii(rows: string[]): Grid {
    const h = rows.length, w = rows[0].length;
    const g = new Grid(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) g.cells[y * w + x] = CHARS[rows[y][x]] ?? CellType.FLOOR;
    g.rebuild();
    return g;
  }

  toAscii(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let s = '';
      for (let x = 0; x < this.w; x++) s += REV[this.cells[y * this.w + x]];
      out.push(s);
    }
    return out;
  }

  clone(): Grid {
    return new Grid(this.w, this.h, this.cells.slice());
  }

  get size(): number {
    return this.w * this.h;
  }
  get rev(): number {
    return this.version;
  }
  idx(x: number, y: number): Cell {
    return y * this.w + x;
  }
  cx(c: Cell): number {
    return c % this.w;
  }
  cy(c: Cell): number {
    return (c / this.w) | 0;
  }
  type(c: Cell): CellType {
    return this.cells[c] as CellType;
  }
  passable(c: Cell): boolean {
    const t = this.cells[c];
    return t !== CellType.SHELF && t !== CellType.OBSTACLE;
  }
  set(c: Cell, t: CellType): void {
    this.cells[c] = t;
    this.rebuild();
  }
  manhattan(a: Cell, b: Cell): number {
    return Math.abs(this.cx(a) - this.cx(b)) + Math.abs(this.cy(a) - this.cy(b));
  }
  chebyshev(a: Cell, b: Cell): number {
    return Math.max(Math.abs(this.cx(a) - this.cx(b)), Math.abs(this.cy(a) - this.cy(b)));
  }
  dirTo(a: Cell, b: Cell): Dir {
    const dx = this.cx(b) - this.cx(a), dy = this.cy(b) - this.cy(a);
    if (dx === 1) return 1;
    if (dx === -1) return 3;
    return dy === 1 ? 2 : 0;
  }
  stations(t: CellType): Cell[] {
    const out: Cell[] = [];
    for (let c = 0; c < this.size; c++) if (this.cells[c] === t) out.push(c);
    return out;
  }

  rebuild(): void {
    this.version++;
    const { w, h } = this;
    this.nbr = new Int32Array(w * h * 4).fill(-1);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        if (!this.passable(c)) continue;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (this.passable(n)) this.nbr[c * 4 + d] = n;
        }
      }
    this.detectCorridors();
  }

  /** Corridor cell: passable, non-bay, exactly 2 passable non-bay neighbours (bays are side pockets). */
  private detectCorridors(): void {
    const n = this.size;
    const isC = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      if (!this.passable(c) || this.cells[c] === CellType.BAY) continue;
      let k = 0;
      for (let d = 0; d < 4; d++) {
        const m = this.nbr[c * 4 + d];
        if (m >= 0 && this.cells[m] !== CellType.BAY) k++;
      }
      if (k === 2) isC[c] = 1;
    }
    this.corridorOf = new Int16Array(n).fill(-1);
    this.corridors = [];
    const cNbrs = (c: Cell): Cell[] => {
      const out: Cell[] = [];
      for (let d = 0; d < 4; d++) {
        const m = this.nbr[c * 4 + d];
        if (m >= 0 && isC[m]) out.push(m);
      }
      return out;
    };
    const walk = (start: Cell, id: number): Cell[] => {
      const chain: Cell[] = [];
      let prev = -1, cur = start;
      while (cur >= 0 && this.corridorOf[cur] < 0) {
        this.corridorOf[cur] = id;
        chain.push(cur);
        const next = cNbrs(cur).find((m) => m !== prev && this.corridorOf[m] < 0);
        prev = cur;
        cur = next ?? -1;
      }
      return chain;
    };
    // chains starting at ends first, then remaining loops
    for (const pass of [0, 1])
      for (let c = 0; c < n; c++) {
        if (!isC[c] || this.corridorOf[c] >= 0) continue;
        if (pass === 0 && cNbrs(c).length >= 2) continue;
        const id = this.corridors.length;
        this.corridors.push({ id, cells: walk(c, id) });
      }
  }
}

const bfsQueue = { buf: new Int32Array(0) };

/** BFS step distances from `goal` over passable cells; -1 = unreachable. `blocked` cells are impassable. */
export function bfsDistances(g: Grid, goal: Cell, blocked?: Uint8Array): Int32Array {
  const n = g.size;
  const dist = new Int32Array(n).fill(-1);
  if (goal < 0 || !g.passable(goal)) return dist;
  if (bfsQueue.buf.length < n) bfsQueue.buf = new Int32Array(n);
  const q = bfsQueue.buf;
  let head = 0, tail = 0;
  q[tail++] = goal;
  dist[goal] = 0;
  const nbr = g.nbr;
  while (head < tail) {
    const c = q[head++];
    const dc = dist[c] + 1;
    for (let d = 0; d < 4; d++) {
      const m = nbr[c * 4 + d];
      if (m < 0 || dist[m] >= 0 || (blocked && blocked[m])) continue;
      dist[m] = dc;
      q[tail++] = m;
    }
  }
  return dist;
}

/** Per-goal BFS cache, keyed by goal cell and invalidated on grid revision. */
export class DistanceCache {
  private maps = new Map<Cell, Int32Array>();
  private rev = -1;
  private g: Grid;
  constructor(g: Grid) {
    this.g = g;
  }
  get(goal: Cell): Int32Array {
    if (this.rev !== this.g.rev) {
      this.maps.clear();
      this.rev = this.g.rev;
    }
    let m = this.maps.get(goal);
    if (!m) {
      m = bfsDistances(this.g, goal);
      this.maps.set(goal, m);
    }
    return m;
  }
}
