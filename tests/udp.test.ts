import { describe, expect, it } from 'vitest';
import { UdpTransport } from '../src/transport/UdpTransport.ts';

describe('UDP transport stub (M10)', () => {
  it('delivers messages between two endpoints on localhost', async () => {
    const a = new UdpTransport(45101, [{ id: 1, host: '127.0.0.1', port: 45102 }]);
    const b = new UdpTransport(45102, [{ id: 0, host: '127.0.0.1', port: 45101 }]);
    await new Promise((r) => setTimeout(r, 50));
    a.broadcast({ type: 'LEFT', from: 0, seq: 1, t: 0, cell: 7 });
    let got: unknown[] = [];
    for (let i = 0; i < 40 && !got.length; i++) {
      await new Promise((r) => setTimeout(r, 10));
      got = b.poll();
    }
    a.close();
    b.close();
    expect(got).toEqual([{ type: 'LEFT', from: 0, seq: 1, t: 0, cell: 7 }]);
  });
});
