import { Grid } from './grid.ts';

export type PresetName = 'default' | 'dense' | 'corridor-heavy' | 'open';
export const PRESETS: PresetName[] = ['default', 'dense', 'corridor-heavy', 'open'];

const W = 30, H = 20;
type Painter = (x: number, y: number) => string;

function build(paint: Painter, w = W, h = H): Grid {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += paint(x, y);
    rows.push(r);
  }
  return Grid.fromAscii(rows);
}

const STATION_ROWS = [3, 6, 9, 12, 15];

/** Walls at x=0/29 with pickup pockets left and dropoff pockets right; chargers + parking bays in row 19. */
function frame(x: number, y: number, chargers: number[], bays: number[]): string | null {
  if (x === 0) return STATION_ROWS.includes(y) ? 'P' : '#';
  if (x === W - 1) return STATION_ROWS.includes(y) ? 'D' : '#';
  if (y === H - 1) return chargers.includes(x) ? 'C' : bays.includes(x) ? 'B' : '#';
  return null;
}

function defaultMap(): Grid {
  const aisles = [4, 7, 10, 13];
  const bayX = [4, 12, 16, 25];
  return build((x, y) => {
    const f = frame(x, y, [6, 12, 18, 24], [3, 9, 15, 21, 26]);
    if (f) return f;
    if (y <= 1 || y >= 16 || x <= 2 || x >= 27 || x === 14) return '.';
    if (aisles.includes(y)) return '.';
    if (aisles.includes(y + 1) && bayX.includes(x)) return 'B';
    return '#';
  });
}

function denseMap(): Grid {
  const cross = [9, 15, 21];
  return build((x, y) => {
    const f = frame(x, y, [6, 12, 18, 24], [3, 9, 15, 21, 26]);
    if (f) return f;
    if (y <= 1 || y >= 16 || x <= 2 || x >= 27 || cross.includes(x)) return '.';
    if (y % 2 === 1 && y <= 13) return '.';
    return '#';
  });
}

function corridorMap(): Grid {
  const corr = [3, 9, 15];
  const bayX = [4, 14, 25];
  return build((x, y) => {
    const f = frame(x, y, [6, 12, 18, 24], [3, 9, 15, 21, 26]);
    if (f) return f;
    if (y === 0) return '#';
    if (y >= 17 || x <= 2 || x >= 27) return '.';
    if (corr.includes(y)) return '.';
    if (corr.includes(y + 1) && bayX.includes(x)) return 'B';
    if (corr.includes(y - 1) && x === 14) return 'B';
    return '#';
  });
}

function openMap(): Grid {
  return build((x, y) => {
    const f = frame(x, y, [6, 12, 18, 24], [3, 9, 15, 21, 26]);
    if (f) return f;
    const bx = (x - 5) % 6, by = (y - 3) % 6;
    if (x >= 5 && x <= 24 && y >= 3 && y <= 15 && bx < 2 && by < 2) return '#';
    return '.';
  });
}

export function makePreset(name: PresetName): Grid {
  switch (name) {
    case 'default': return defaultMap();
    case 'dense': return denseMap();
    case 'corridor-heavy': return corridorMap();
    case 'open': return openMap();
  }
}
