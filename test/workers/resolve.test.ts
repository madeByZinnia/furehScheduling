import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { verifyInitData } from '../../src/worker/telegram';

// Matches the miniflare BOT_TOKEN binding in vitest.workers.config.ts, so the
// SELF.fetch('/api/resolve') path verifies against the same key.
const TOKEN = 'test-bot-token';

const enc = new TextEncoder();

async function hmacRaw(keyData: BufferSource, msg: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, enc.encode(msg));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function dataCheckString(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
}

/** Sign like Telegram does (correct order): secret = HMAC('WebAppData', token). */
async function signValid(fields: Record<string, string>, token: string): Promise<string> {
  const secret = await hmacRaw(enc.encode('WebAppData'), token);
  const hash = toHex(await hmacRaw(new Uint8Array(secret), dataCheckString(fields)));
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

/** Sign with the key/message SWAPPED — a valid signature of the WRONG scheme. */
async function signSwapped(fields: Record<string, string>, token: string): Promise<string> {
  const secret = await hmacRaw(enc.encode(token), 'WebAppData');
  const hash = toHex(await hmacRaw(new Uint8Array(secret), dataCheckString(fields)));
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

const SAMPLE = {
  auth_date: '1752000000',
  query_id: 'AAF-example',
  user: JSON.stringify({ id: 42, first_name: 'Robin', username: 'robin' }),
};

describe('verifyInitData', () => {
  it('accepts a validly-signed blob and returns the user', async () => {
    const blob = await signValid(SAMPLE, TOKEN);
    const result = await verifyInitData(blob, TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user?.id).toBe(42);
  });

  it('rejects the WRONG HMAC order — pins secret = HMAC("WebAppData", token)', async () => {
    // If verifyInitData used the swapped order, this would (wrongly) verify.
    const blob = await signSwapped(SAMPLE, TOKEN);
    const result = await verifyInitData(blob, TOKEN);
    expect(result.ok).toBe(false);
  });

  it('rejects a blob with no hash', async () => {
    const result = await verifyInitData('auth_date=1&user=%7B%7D', TOKEN);
    expect(result.ok).toBe(false);
  });

  it('property: any single mutation of a signed blob is rejected', async () => {
    const arbFields = fc
      .dictionary(
        fc.string({ minLength: 1 }).filter((k) => k !== 'hash'),
        fc.string(),
        { minKeys: 1, maxKeys: 5 },
      )
      .filter((d) => Object.keys(d).length > 0);

    await fc.assert(
      fc.asyncProperty(arbFields, fc.string(), async (fields, extra) => {
        const blob = await signValid(fields, TOKEN);
        expect((await verifyInitData(blob, TOKEN)).ok).toBe(true);

        // Mutate the hash by one hex nibble → reject.
        const p = new URLSearchParams(blob);
        const hash = p.get('hash') ?? '';
        const flipped = (hash[0] === '0' ? '1' : '0') + hash.slice(1);
        p.set('hash', flipped);
        expect((await verifyInitData(p.toString(), TOKEN)).ok).toBe(false);

        // Add/replace a field without re-signing → reject (hash no longer covers it).
        const p2 = new URLSearchParams(blob);
        p2.set('injected', extra);
        expect((await verifyInitData(p2.toString(), TOKEN)).ok).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});

describe('POST /api/resolve', () => {
  it('mints an access code for valid initData', async () => {
    const blob = await signValid(SAMPLE, TOKEN);
    const res = await SELF.fetch('https://example.com/api/resolve', {
      method: 'POST',
      body: JSON.stringify({ initData: blob }),
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ accessCode: string; user: { id: number } | null }>();
    expect(typeof data.accessCode).toBe('string');
    expect(data.user?.id).toBe(42);
  });

  it('rejects tampered initData with 401', async () => {
    const blob = await signValid(SAMPLE, TOKEN);
    const tampered = blob.replace('Robin', 'Mallory');
    const res = await SELF.fetch('https://example.com/api/resolve', {
      method: 'POST',
      body: JSON.stringify({ initData: tampered }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a missing body with 401', async () => {
    const res = await SELF.fetch('https://example.com/api/resolve', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
