import { SENSOR_RANGE } from '../shared/constants.ts';
import type { Grid } from '../shared/grid.ts';
import type { Cell, SensedRobot } from '../shared/types.ts';
import type { Body } from './physics.ts';

/**
 * Onboard sensing within Chebyshev range. `occ` is a per-cell robot index (+1) acting as the
 * spatial hash, so each query scans a fixed (2r+1)^2 window: O(n) per tick overall.
 */
export function sense(
  g: Grid, self: Body, bodies: Body[], occ: Int16Array, obstacle: Uint8Array,
): { robots: SensedRobot[]; obstacles: Cell[] } {
  const robots: SensedRobot[] = [];
  const obstacles: Cell[] = [];
  const x0 = g.cx(self.cell), y0 = g.cy(self.cell);
  const r = SENSOR_RANGE;
  let seen = 0; // bitmask for ids < 31, else linear check
  for (let y = Math.max(0, y0 - r); y <= Math.min(g.h - 1, y0 + r); y++)
    for (let x = Math.max(0, x0 - r); x <= Math.min(g.w - 1, x0 + r); x++) {
      const c = y * g.w + x;
      if (obstacle[c]) obstacles.push(c);
      const o = occ[c];
      if (!o) continue;
      const b = bodies[o - 1];
      if (b.id === self.id) continue;
      if (b.id < 31) {
        if (seen & (1 << b.id)) continue;
        seen |= 1 << b.id;
      } else if (robots.some((s) => s.id === b.id)) continue;
      robots.push({
        id: b.id,
        cell: b.cell,
        heading: b.heading,
        indicator: b.alive ? b.indicator : -1,
        moving: b.busy === 'move',
        to: b.busy === 'move' ? b.target : -1,
      });
    }
  return { robots, obstacles };
}
