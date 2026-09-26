import { bfsDistances, type Grid } from '../shared/grid.ts';
import { CellType } from '../shared/types.ts';

export const MAX_UNBAYED_CORRIDOR = 6;
export const BAY_REACH = 3;

export function validateMap(g: Grid): string[] {
  const errors: string[] = [];
  const pick = g.stations(CellType.PICKUP), drop = g.stations(CellType.DROPOFF);
  const chg = g.stations(CellType.CHARGER), bays = g.stations(CellType.BAY);
  if (!chg.length) errors.push('Map needs at least one charger.');
  if (!pick.length) errors.push('Map needs at least one pickup station.');
  if (!drop.length) errors.push('Map needs at least one dropoff station.');
  const stations = [...pick, ...drop, ...chg, ...bays];
  if (stations.length) {
    const dist = bfsDistances(g, stations[0]);
    for (const s of stations)
      if (dist[s] < 0) errors.push(`Station at (${g.cx(s)},${g.cy(s)}) is unreachable.`);
  }
  for (const cor of g.corridors) {
    if (cor.cells.length <= MAX_UNBAYED_CORRIDOR) continue;
    const ends = [cor.cells[0], cor.cells[cor.cells.length - 1]];
    for (const e of ends)
      if (!bays.some((b) => g.manhattan(b, e) <= BAY_REACH))
        errors.push(`Corridor ${cor.id} (len ${cor.cells.length}) has no bay within ${BAY_REACH} of end (${g.cx(e)},${g.cy(e)}).`);
  }
  return errors;
}
