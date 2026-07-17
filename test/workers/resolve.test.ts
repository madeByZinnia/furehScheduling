import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { verifyInitData, resolveCrewRef } from '../../src/worker/telegram';

// Matches the miniflare BOT_TOKEN binding in vitest.workers.config.ts, so the
// SELF.fetch('/api/resolve') path verifies against the same key.
const TOKEN = 'test-bot-token';

// Fixed reference instant for deterministic auth_date checks.
const NOW_MS = 1_800_000_000_000;
const FRESH_AUTH = String(Math.floor(NOW_MS / 1000) - 30); // 30s before NOW_MS

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

const SAMPLE: Record<string, string> = {
  auth_date: FRESH_AUTH,
  query_id: 'AAF-example',
  user: JSON.stringify({ id: 42, first_name: 'Robin', username: 'robin' }),
};

/** A blob signed with an auth_date fresh relative to the REAL clock (for SELF). */
async function realFreshBlob(): Promise<string> {
  return signValid({ ...SAMPLE, auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN);
}

describe('verifyInitData', () => {
  it('accepts a validly-signed, fresh blob and returns the user', async () => {
    const blob = await signValid(SAMPLE, TOKEN);
    const result = await verifyInitData(blob, TOKEN, NOW_MS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user?.id).toBe(42);
  });

  it('rejects the WRONG HMAC order — pins secret = HMAC("WebAppData", token)', async () => {
    const blob = await signSwapped(SAMPLE, TOKEN);
    const result = await verifyInitData(blob, TOKEN, NOW_MS);
    expect(result.ok).toBe(false);
  });

  it('rejects a blob with no hash', async () => {
    const result = await verifyInitData('auth_date=1&user=%7B%7D', TOKEN, NOW_MS);
    expect(result.ok).toBe(false);
  });

  it('rejects a stale auth_date (replay protection)', async () => {
    const stale = { ...SAMPLE, auth_date: String(Math.floor(NOW_MS / 1000) - 90_000) };
    const blob = await signValid(stale, TOKEN);
    expect((await verifyInitData(blob, TOKEN, NOW_MS)).ok).toBe(false);
  });

  it('rejects a far-future auth_date', async () => {
    const future = { ...SAMPLE, auth_date: String(Math.floor(NOW_MS / 1000) + 3600) };
    const blob = await signValid(future, TOKEN);
    expect((await verifyInitData(blob, TOKEN, NOW_MS)).ok).toBe(false);
  });

  it('rejects a missing auth_date even when signed', async () => {
    const { auth_date: _omit, ...noDate } = SAMPLE;
    const blob = await signValid(noDate, TOKEN);
    expect((await verifyInitData(blob, TOKEN, NOW_MS)).ok).toBe(false);
  });

  it('property: any single mutation of a signed blob is rejected', async () => {
    const arbFields = fc
      .dictionary(
        fc.string({ minLength: 1 }).filter((k) => k !== 'hash' && k !== 'auth_date'),
        fc.string(),
        { minKeys: 1, maxKeys: 5 },
      )
      .filter((d) => Object.keys(d).length > 0);

    await fc.assert(
      fc.asyncProperty(arbFields, fc.string(), async (fields, extra) => {
        const signed = { ...fields, auth_date: FRESH_AUTH };
        const blob = await signValid(signed, TOKEN);
        expect((await verifyInitData(blob, TOKEN, NOW_MS)).ok).toBe(true);

        // Mutate the hash by one hex nibble → reject.
        const p = new URLSearchParams(blob);
        const hash = p.get('hash') ?? '';
        const flipped = (hash[0] === '0' ? '1' : '0') + hash.slice(1);
        p.set('hash', flipped);
        expect((await verifyInitData(p.toString(), TOKEN, NOW_MS)).ok).toBe(false);

        // Add a field without re-signing → reject (hash no longer covers it).
        const p2 = new URLSearchParams(blob);
        p2.set('injected', extra);
        expect((await verifyInitData(p2.toString(), TOKEN, NOW_MS)).ok).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});

describe('POST /api/resolve', () => {
  it('mints an access code for valid initData', async () => {
    const res = await SELF.fetch('https://example.com/api/resolve', {
      method: 'POST',
      body: JSON.stringify({ initData: await realFreshBlob() }),
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ accessCode: string; user: { id: number } | null }>();
    expect(typeof data.accessCode).toBe('string');
    expect(data.user?.id).toBe(42);
  });

  it('rejects tampered initData with 401', async () => {
    const tampered = (await realFreshBlob()).replace('Robin', 'Mallory');
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

// resolveCrewRef is the crew SELECTOR over already-verified params. It tags each
// source with its trust: a signed `chat.id` (attachment-menu launch) is an
// authorization signal on its own (`trusted:true`); a signed `start_param`
// (direct-link launch) is user-chosen, so it is `trusted:false` and the caller
// MUST membership-verify it. `chat` wins when both are present.
describe('resolveCrewRef — crew selection + trust (SECURITY)', () => {
  const params = (fields: Record<string, string>): URLSearchParams =>
    new URLSearchParams(fields);

  it('valid chat.id → trusted crew ref (no membership check needed)', () => {
    expect(
      resolveCrewRef(params({ chat: JSON.stringify({ id: 900001, type: 'supergroup' }) })),
    ).toEqual({ crewId: '900001', trusted: true });
    // Negative ids (Telegram group ids are negative) still work.
    expect(resolveCrewRef(params({ chat: JSON.stringify({ id: -1001234567890 }) }))).toEqual({
      crewId: '-1001234567890',
      trusted: true,
    });
  });

  it('fractional chat.id → null (not a safe integer, no start_param fallback)', () => {
    expect(resolveCrewRef(params({ chat: JSON.stringify({ id: 1.5 }) }))).toBeNull();
  });

  it('unsafe-integer chat.id → null (precision-losing, could alias another DO)', () => {
    // MAX_SAFE_INTEGER + 2 is not representable exactly, so reject it.
    expect(
      resolveCrewRef(params({ chat: `{"id":${Number.MAX_SAFE_INTEGER + 2},"type":"supergroup"}` })),
    ).toBeNull();
  });

  it('missing chat and no start_param → null', () => {
    expect(resolveCrewRef(params({ query_id: 'AAF-example' }))).toBeNull();
  });

  it('malformed chat JSON → null (never throws; falls through to start_param)', () => {
    expect(resolveCrewRef(params({ chat: 'not-json' }))).toBeNull();
    expect(resolveCrewRef(params({ chat: '{"id":}' }))).toBeNull();
  });

  it('SECURITY: start_param alone → UNTRUSTED crew ref (membership-verified by caller)', () => {
    // start_param is user-chosen; a signed value is NOT authorization on its own,
    // so it is returned as trusted:false and the caller must verify membership.
    expect(resolveCrewRef(params({ start_param: '900001' }))).toEqual({
      crewId: '900001',
      trusted: false,
    });
  });

  it('non-integer start_param → null (never a chat id, so not a crew)', () => {
    expect(resolveCrewRef(params({ start_param: 'crew-A', query_id: 'x' }))).toBeNull();
    expect(resolveCrewRef(params({ start_param: '' }))).toBeNull();
  });

  it('signed chat.id WINS over a start_param, and stays trusted', () => {
    expect(
      resolveCrewRef(
        params({ chat: JSON.stringify({ id: 111 }), start_param: '222' }),
      ),
    ).toEqual({ crewId: '111', trusted: true });
  });
});

describe('GET /telegram/resolve-check', () => {
  it('serves the diagnostic HTML page', async () => {
    const res = await SELF.fetch('https://example.com/telegram/resolve-check');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});
