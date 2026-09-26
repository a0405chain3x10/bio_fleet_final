/**
 * Headless single-agent runner for Node.js / Raspberry Pi benchmarking. The agent code is exactly
 * the browser agent; the "hardware" is a local one-robot World and the radio is UDP.
 *   node src/node/agent-node.ts --id 0 --port 41000 --peers 1:41001,2:41002 [--ticks 600] [--fast]
 */
import { BioFleetAgent } from '../agent/Agent.ts';
import { DEFAULT_PARAMS } from '../agent/contracts.ts';
import { TICK_MS } from '../shared/constants.ts';
import { makePreset } from '../shared/maps.ts';
import { CellType } from '../shared/types.ts';
import { UdpTransport } from '../transport/UdpTransport.ts';
import { World } from '../world/World.ts';

const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const id = Number(arg('id', '0'));
const port = Number(arg('port', String(41000 + id)));
const peers = arg('peers', '').split(',').filter(Boolean).map((s) => {
  const [pid, pport] = s.split(':').map(Number);
  return { id: pid, host: '127.0.0.1', port: pport };
});
const ticks = Number(arg('ticks', '600'));
const fast = process.argv.includes('--fast');

const grid = makePreset('default');
const world = new World(grid);
world.addRobot(grid.idx(3 + id * 2, 17));
const P = grid.stations(CellType.PICKUP), D = grid.stations(CellType.DROPOFF);
const mission = Array.from({ length: 20 }, (_, k) => ({ id: `n${id}-${k}`, pickup: P[(k + id) % P.length], drop: D[(k * 3 + id) % D.length], urgency: 1 }));
for (const m of mission) world.releaseTask(m);
const agent = new BioFleetAgent({ id, mode: 'biofleet', map: grid.toAscii(), seed: 1, params: DEFAULT_PARAMS, mission });
const io = new UdpTransport(port, peers);

const times: number[] = [];
const pct = (p: number) => [...times].sort((a, b) => a - b)[Math.floor(p * (times.length - 1))] ?? 0;

function tick(): void {
  // the local World holds only this robot (index 0); the agent keeps its fleet id
  const o = world.observe(0, io.poll());
  o.self.id = id;
  const t0 = performance.now();
  const a = agent.step(o);
  times.push(performance.now() - t0);
  for (const x of a.outbox) (x.to === undefined ? io.broadcast(x.msg) : io.send(x.to, x.msg));
  world.step([a]);
  if (world.t % 100 === 0)
    console.log(`r${id} t=${world.t} step ms p50=${pct(0.5).toFixed(3)} p95=${pct(0.95).toFixed(3)} done=${world.tasksDone()} tx=${io.stats.sent} rx=${io.stats.recv} peers=${agent.peers.peers.size}`);
}

async function main(): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    tick();
    await new Promise((r) => setTimeout(r, fast ? 0 : TICK_MS));
  }
  io.close();
}
void main();
