import { createSocket, type Socket } from 'node:dgram';
import { msgBytes, type Msg } from '../shared/messages.ts';
import type { RobotId } from '../shared/types.ts';
import type { Transport } from './Transport.ts';

export interface UdpPeer {
  id: RobotId;
  host: string;
  port: number;
}

/**
 * Node-only Transport over UDP (stub for real hardware): JSON datagrams, "broadcast" = unicast to
 * every known peer. Received datagrams queue until the agent polls.
 */
export class UdpTransport implements Transport {
  private sock: Socket;
  private inbox: Msg[] = [];
  private peers: UdpPeer[];
  stats = { sent: 0, recv: 0, bytesSent: 0, bytesRecv: 0 };

  constructor(port: number, peers: UdpPeer[]) {
    this.peers = peers;
    this.sock = createSocket('udp4');
    this.sock.on('message', (buf) => {
      try {
        this.inbox.push(JSON.parse(buf.toString('utf8')) as Msg);
        this.stats.recv++;
        this.stats.bytesRecv += buf.length;
      } catch {
        /* malformed datagram: drop */
      }
    });
    this.sock.bind(port);
  }

  private out(p: UdpPeer, m: Msg): void {
    const data = JSON.stringify(m);
    this.stats.sent++;
    this.stats.bytesSent += msgBytes(m);
    this.sock.send(data, p.port, p.host);
  }

  broadcast(m: Msg): void {
    for (const p of this.peers) this.out(p, m);
  }

  send(to: RobotId, m: Msg): void {
    const p = this.peers.find((x) => x.id === to);
    if (p) this.out(p, m);
  }

  poll(): Msg[] {
    const r = this.inbox;
    this.inbox = [];
    return r;
  }

  close(): void {
    this.sock.close();
  }
}
