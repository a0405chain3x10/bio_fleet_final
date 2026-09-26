import { Grid } from '../shared/grid.ts';
import { makePreset, type PresetName } from '../shared/maps.ts';
import { Rng } from '../shared/rng.ts';
import { CellType, type Cell, type Dir, type Task } from '../shared/types.ts';
import type { SimConfig } from '../runtime/Simulation.ts';
import type { FaultEvent } from '../world/faults.ts';
import type { Rect } from '../transport/Transport.ts';

export type Mode = 'biofleet' | 'baseline';
export type FaultName = 'none' | 'F1-10' | 'F1-30' | 'F2' | 'F3' | 'F4';

export interface ScenarioSpec {
  name: string;
  robots: number;
  fault: FaultName;
}

const S1_MAP = (() => {
  const rows: string[] = [];
  for (let y = 0; y < 17; y++) {
    let r = '';
    for (let x = 0; x < 17; x++) {
      const road = x === 7 || x === 8 || y === 7 || y === 8;
      let ch = road && x > 0 && x < 16 && y > 0 && y < 16 ? '.' : '#';
      if (y === 0 && (x === 7 || x === 8)) ch = x === 7 ? 'P' : 'D';
      if (y === 16 && (x === 7 || x === 8)) ch = x === 7 ? 'P' : 'D';
      if (x === 0 && (y === 7 || y === 8)) ch = y === 7 ? 'P' : 'D';
      if (x === 16 && (y === 7 || y === 8)) ch = y === 7 ? 'P' : 'D';
      if ((x === 6 && y === 2) || (x === 9 && y === 14)) ch = 'C';
      if ((x === 9 && y === 2) || (x === 6 && y === 14) || (x === 2 && y === 6) || (x === 14 && y === 9)) ch = 'B';
      r += ch;
    }
    rows.push(r);
  }
  return rows;
})();

const S2_MAP = [
  '########################',
  '#......................#',
  '#..B##############B##..#',
  '#..##################..#',
  'P......................P',
  'D..B######B#######B##..D',
  '#..##################..#',
  '#..##################..#',
  '#C####################C#',
];

const S3_MAP = (() => {
  const rows: string[] = [];
  for (let y = 0; y < 11; y++) {
    let r = '';
    for (let x = 0; x < 21; x++) {
      let ch = x === 0 || x === 20 || y === 0 || y === 10 || (x === 10 && y !== 5) ? '#' : '.';
      if (x === 0 && (y === 3 || y === 7)) ch = 'P';
      if (x === 0 && y === 5) ch = 'D';
      if (x === 20 && (y === 3 || y === 7)) ch = 'P';
      if (x === 20 && y === 5) ch = 'D';
      if (y === 10 && (x === 5 || x === 15)) ch = 'C';
      if (y === 10 && (x === 3 || x === 17 || x === 7 || x === 13)) ch = 'B';
      r += ch;
    }
    rows.push(r);
  }
  return rows;
})();

export const SCENARIO_MAPS: Record<string, string[]> = { S1: S1_MAP, S2: S2_MAP, S3: S3_MAP };

let taskCounter = 0;
const mk = (pickup: Cell, drop: Cell, tag: string): Task => ({ id: `${tag}-${taskCounter++}`, pickup, drop, urgency: 1 });

/** Mission of `legs` alternating legs between two ends: pick at A → drop at B, pick at B → drop at A, … */
function shuttle(A: { p: Cell; d: Cell }, B: { p: Cell; d: Cell }, legs: number, tag: string): Task[] {
  const out: Task[] = [];
  for (let i = 0; i < legs; i++) out.push(i % 2 === 0 ? mk(A.p, B.d, tag) : mk(B.p, A.d, tag));
  return out;
}

function s1(): Partial<SimConfig> {
  const g = Grid.fromAscii(S1_MAP);
  const end = (px: number, py: number, dx: number, dy: number) => ({ p: g.idx(px, py), d: g.idx(dx, dy) });
  const N = end(7, 0, 8, 0), S = end(7, 16, 8, 16), W = end(0, 7, 0, 8), E = end(16, 7, 16, 8);
  return {
    map: S1_MAP,
    robots: [{ cell: g.idx(7, 1), heading: 0 }, { cell: g.idx(8, 15), heading: 2 }, { cell: g.idx(1, 8), heading: 3 }, { cell: g.idx(15, 7), heading: 1 }],
    missions: [shuttle(N, S, 4, 'n'), shuttle(S, N, 4, 's'), shuttle(W, E, 4, 'w'), shuttle(E, W, 4, 'e')],
    maxTicks: 6000,
  };
}

function s2(n: number): Partial<SimConfig> {
  const g = Grid.fromAscii(S2_MAP);
  const L = { p: g.idx(0, 4), d: g.idx(0, 5) }, R = { p: g.idx(23, 4), d: g.idx(23, 5) };
  const starts = [g.idx(1, 4), g.idx(22, 4), g.idx(2, 5), g.idx(21, 5)];
  const robots = starts.slice(0, n).map((cell, i) => ({ cell, heading: (i % 2 === 0 ? 3 : 1) as 1 | 3 }));
  const missions = robots.map((_, i) => (i % 2 === 0 ? shuttle(L, R, 4, `l${i}`) : shuttle(R, L, 4, `r${i}`)));
  return { map: S2_MAP, robots, missions, maxTicks: 6000 };
}

function s3(): Partial<SimConfig> {
  const g = Grid.fromAscii(S3_MAP);
  const Lp = [g.idx(0, 3), g.idx(0, 7)], Rp = [g.idx(20, 3), g.idx(20, 7)];
  const Ld = g.idx(0, 5), Rd = g.idx(20, 5);
  const robots: { cell: Cell; heading: Dir }[] = [3, 5, 7].map((y) => ({ cell: g.idx(2, y), heading: 3 as Dir }))
    .concat([3, 5, 7].map((y) => ({ cell: g.idx(18, y), heading: 1 as Dir })));
  const missions = robots.map((_, i) => {
    const left = i < 3;
    const A = { p: (left ? Lp : Rp)[i % 2], d: left ? Ld : Rd }, B = { p: (left ? Rp : Lp)[i % 2], d: left ? Rd : Ld };
    return shuttle(A, B, 4, `b${i}`);
  });
  return { map: S3_MAP, robots, missions, maxTicks: 8000 };
}

/** Full warehouse: seeded batch of tasks published by pickup stations; robots start in the bottom aisles. */
export function s4(seed: number, n: number, preset: PresetName = 'default', tasks = 50): Partial<SimConfig> {
  const g = makePreset(preset);
  const rng = new Rng(seed * 31 + n);
  const free: Cell[] = [];
  for (let y = 16; y <= 18; y++) for (let x = 1; x <= 28; x++) if (g.type(g.idx(x, y)) === CellType.FLOOR) free.push(g.idx(x, y));
  rng.shuffle(free);
  const P = g.stations(CellType.PICKUP), D = g.stations(CellType.DROPOFF);
  const batch = Array.from({ length: tasks }, (_, k) => ({
    id: `T${k}`, pickup: rng.pick(P), drop: rng.pick(D), urgency: rng.next() < 0.2 ? 2 : 1,
  }));
  return {
    map: g.toAscii(),
    robots: free.slice(0, n).map((cell) => ({ cell, heading: rng.int(0, 3) as 0 })),
    batch,
    maxTicks: 30000,
  };
}

const BUSY_INTERSECTION: Rect = { x0: 12, y0: 8, x1: 16, y1: 12 };

function faults(f: FaultName, g: Grid): { bus?: SimConfig['bus']; faults?: FaultEvent[] } {
  switch (f) {
    case 'none': return {};
    case 'F1-10': return { bus: { loss: 0.1 } };
    case 'F1-30': return { bus: { loss: 0.3 } };
    case 'F2': return { bus: { deadZones: [BUSY_INTERSECTION] } };
    case 'F3': return { faults: [{ t: 300, kind: 'obstacle', cells: [g.idx(8, 7)] }] };
    case 'F4': return { faults: [{ t: 400, kind: 'kill', robot: 'busiest' }] };
  }
}

export function buildScenario(spec: ScenarioSpec, mode: Mode, seed: number, params?: SimConfig['params']): SimConfig {
  taskCounter = 0;
  const base = spec.name === 'S1' ? s1() : spec.name === 'S2' ? s2(spec.robots) : spec.name === 'S3' ? s3()
    : s4(seed, spec.robots, (spec.name.split(':')[1] as PresetName) || 'default');
  const g = Grid.fromAscii(base.map!);
  const f = faults(spec.fault, g);
  return { ...base, ...f, mode, seed, params, map: base.map!, robots: base.robots!, maxTicks: base.maxTicks! } as SimConfig;
}

export const MATRIX: ScenarioSpec[] = [
  { name: 'S1', robots: 4, fault: 'none' },
  { name: 'S2', robots: 2, fault: 'none' },
  { name: 'S2', robots: 4, fault: 'none' },
  { name: 'S3', robots: 6, fault: 'none' },
  { name: 'S4', robots: 3, fault: 'none' },
  { name: 'S4', robots: 5, fault: 'none' },
  { name: 'S4', robots: 10, fault: 'none' },
  { name: 'S4', robots: 20, fault: 'none' },
  { name: 'S4:dense', robots: 20, fault: 'none' },
  { name: 'S4', robots: 10, fault: 'F1-10' },
  { name: 'S4', robots: 10, fault: 'F1-30' },
  { name: 'S4', robots: 10, fault: 'F2' },
  { name: 'S4', robots: 10, fault: 'F3' },
  { name: 'S4', robots: 10, fault: 'F4' },
];
