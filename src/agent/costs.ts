import type { BioFleetAgent } from './Agent.ts';
import { freshIntent } from './passingOrder.ts';

const HEADON = 25;
const CROSS = 2;
const STATIC_PEER = 25;
const CORRIDOR_OPPOSED = 20;

/** Planner edge costs (ticks): learned delay + intent-aware head-on/crossing penalties + corridor locks. */
export function buildEdgeCosts(a: BioFleetAgent): void {
  const g = a.grid, ec = a.edgeCost, t = a.now;
  const learned = a.learnedCosts();
  if (learned) ec.set(learned);
  else ec.fill(0);
  const W = a.params.window;
  for (const p of a.peers.peers.values()) {
    if (p.id === a.id || t - p.lastHeard > 20 || p.cell < 0) continue;
    if (!freshIntent(p, t) || p.state.endsWith(':wait') || p.state === 'parked' || p.state === 'charging') {
      for (let d = 0; d < 4; d++) {
        const src = g.nbr[p.cell * 4 + ((d + 2) & 3)];
        if (src >= 0) ec[src * 4 + d] += STATIC_PEER;
      }
      continue;
    }
    let prev = p.cell;
    for (let i = 0; i < Math.min(W, p.intent.length); i++) {
      const b = p.intent[i];
      if (g.manhattan(prev, b) !== 1) break;
      const d = g.dirTo(prev, b), w = i < 4 ? 1 : 0.5;
      ec[b * 4 + ((d + 2) & 3)] += HEADON * w;
      for (const e of [(d + 1) & 3, (d + 3) & 3]) {
        const src = g.nbr[b * 4 + ((e + 2) & 3)];
        if (src >= 0) ec[src * 4 + e] += CROSS * w;
      }
      prev = b;
    }
  }
  for (const en of a.corridors.entries) {
    const load = a.corridors.opposingLoad(en.cid, en.dir, t);
    if (load > 0) ec[en.from * 4 + g.dirTo(en.from, en.into)] += CORRIDOR_OPPOSED + 5 * g.corridors[en.cid].cells.length;
  }
}
