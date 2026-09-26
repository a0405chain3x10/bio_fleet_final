import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hex, hmacSha256, sha256, signMsg } from '../src/shared/hmac.ts';

describe('HMAC-SHA256', () => {
  it('matches WebCrypto', async () => {
    const enc = new TextEncoder();
    for (const [k, m] of [['fleet-key', 'hello'], ['a', ''], ['k'.repeat(100), 'x'.repeat(200)]]) {
      const key = await webcrypto.subtle.importKey('raw', enc.encode(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const ref = new Uint8Array(await webcrypto.subtle.sign('HMAC', key, enc.encode(m)));
      expect(hex(hmacSha256(k, m))).toBe(hex(ref));
    }
    expect(hex(sha256(enc.encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('signature ignores the sig field and changes with content', () => {
    const m = { type: 'LEFT', from: 1, seq: 2, t: 3, cell: 4 };
    const s = signMsg('k', m);
    expect(signMsg('k', { ...m, sig: s })).toBe(s);
    expect(signMsg('k', { ...m, cell: 5 })).not.toBe(s);
    expect(signMsg('other', m)).not.toBe(s);
  });
});
