import { describe, expect, it } from 'vitest';
import { Grid } from '../src/shared/grid.ts';
import { makePreset, PRESETS } from '../src/shared/maps.ts';
import { CellType } from '../src/shared/types.ts';
import { validateMap } from '../src/world/mapValidation.ts';

describe('map validation', () => {
  it('accepts all presets', () => {
    for (const p of PRESETS) expect(validateMap(makePreset(p)), p).toEqual([]);
  });
  it('requires a charger', () => {
    const g = makePreset('open');
    for (const c of g.stations(CellType.CHARGER)) g.cells[c] = CellType.SHELF;
    g.rebuild();
    expect(validateMap(g).some((e) => e.includes('charger'))).toBe(true);
  });
  it('flags unreachable stations', () => {
    const g = makePreset('default');
    g.set(g.idx(1, 3), CellType.SHELF);
    g.set(g.idx(1, 2), CellType.SHELF);
    g.set(g.idx(1, 4), CellType.SHELF);
    expect(validateMap(g).some((e) => e.includes('unreachable'))).toBe(true);
  });
  it('flags long corridors without bays', () => {
    const rows = ['##########', 'P........C', '#.######.#', '#D......B#', '##########'];
    const g = Grid.fromAscii(rows);
    const errs = validateMap(g);
    expect(errs.some((e) => e.includes('no bay'))).toBe(true);
  });
  it('detects corridors as chains of 2-neighbour cells', () => {
    const g = Grid.fromAscii(['#####', '.....', '#####']);
    expect(g.corridors.length).toBe(1);
    expect(g.corridors[0].cells.length).toBe(3);
  });
});
