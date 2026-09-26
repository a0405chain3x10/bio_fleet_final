import { Grid } from '../src/shared/grid.ts';
import { Rng } from '../src/shared/rng.ts';
import { CellType } from '../src/shared/types.ts';

/** Random map: border floor, random shelves, guaranteed stations in corners. */
export function randomGrid(seed: number, w = 16, h = 12, density = 0.25): Grid {
  const rng = new Rng(seed);
  const g = new Grid(w, h);
  for (let c = 0; c < g.size; c++) if (rng.next() < density) g.cells[c] = CellType.SHELF;
  g.rebuild();
  return g;
}
