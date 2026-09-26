import type { Cell, RobotId } from '../shared/types.ts';
import type { Peer } from './peers.ts';

export const INTENT_FRESH = 30;
/** only order against robots that will reach the shared cell soon (index in their INTENT) */
export const PASS_HORIZON = 4;
const LEFT_FRESH = 30;

export const freshIntent = (p: Peer, t: number): boolean => p.intent.length > 0 && t - p.intentT <= INTENT_FRESH;

/**
 * Decentralized action-dependency ordering: for a cell in both my INTENT and a neighbour's, the
 * higher (message-carried) priority passes first. I wait until its LEFT(cell), a heartbeat past
 * the cell, or an INTENT without the cell.
 */
export function passingBlocker(next: Cell, myPrio: number, peers: Iterable<Peer>, t: number): Peer | null {
  for (const p of peers) {
    if (!freshIntent(p, t) || p.priority <= myPrio) continue;
    const k = p.intent.indexOf(next);
    if (k < 0 || k > PASS_HORIZON) continue;
    const left = p.left.get(next);
    if (left !== undefined && t - left <= LEFT_FRESH && left >= p.intentT) continue;
    if (p.cell === next) continue; // physically there: the safety layer handles it
    return p;
  }
  return null;
}

/** A neighbour whose next cells include the cell I stand on while I need its cells: head-on. */
export function headOnWith(cell: Cell, next: Cell, peers: Iterable<Peer>, t: number): Peer | null {
  for (const p of peers) {
    if (!freshIntent(p, t) || p.cell < 0) continue;
    const i = p.intent.indexOf(cell);
    if (i < 0 || i > 3) continue;
    if (next === p.cell || p.intent.slice(0, i).includes(next)) return p;
  }
  return null;
}

/**
 * Do I have to yield in a head-on? A robot pinned where it cannot step aside (inside a corridor or a
 * dead-end pocket) keeps going; otherwise the carried priority decides.
 */
export function mustYield(myPrio: number, mePinned: boolean, p: Peer, peerPinned: boolean): boolean {
  if (peerPinned !== mePinned) return !mePinned;
  return p.priority > myPrio;
}

export function contested(c: Cell, peers: Iterable<Peer>, t: number, me: RobotId): boolean {
  for (const p of peers) if (p.id !== me && freshIntent(p, t) && p.intent.includes(c)) return true;
  return false;
}
