import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Real, baked occurrence ids (see src/data/schedule.json) so a non-ghost
// member's plans resolve to title/start/room. z is a third distinct id.
const X = 'GGATRR@2026-07-16T17:00:00-06:00';
const Y = 'AKESSA@2026-07-16T19:30:00-06:00';
const Z = 'RUPMLX@2026-07-16T22:00:00-06:00';

// ── Valid-initData signing (mirrors resolve.test.ts) ─────────────────────────
// The pool binds BOT_TOKEN='test-bot-token' (vitest.workers.config.ts), so a
// blob signed with this token verifies through the real Worker fetch path.
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

/** A fresh, validly-signed blob for a given user id (auth_date on the real clock). */
async function freshInitData(userId: number): Promise<string> {
  return signValid(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'AAF-example',
      user: JSON.stringify({ id: userId, first_name: 'Robin', username: 'robin' }),
    },
    TOKEN,
  );
}

/** POST a JSON body to the running Worker and return the Response. */
function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function rosterFor(chatId: number, userId: number): Promise<{
  roster: { userId: number; ghost: boolean; plans: { occurrenceId: string }[] }[];
}> {
  const res = await post('/api/roster', { initData: await freshInitData(userId), chatId });
  expect(res.status).toBe(200);
  return res.json<{
    roster: { userId: number; ghost: boolean; plans: { occurrenceId: string }[] }[];
  }>();
}

// These tests exercise the REAL Durable Object via the workers pool (miniflare).
// The roster RPCs touch no Telegram API, so no fetch stub is needed.

describe('Crew roster + ghost mode', () => {
  it('redacts a ghost member plans in getRoster while keeping them in the roster', async () => {
    const crew = env.CREW.getByName('roster-ghost');
    // A: visible, two stars. B: ghost, one star.
    await crew.syncMember(101, 'Alice', false, [X, Y]);
    await crew.syncMember(202, 'Bob', true, [Z]);

    const roster = await crew.getRoster();
    // Both members appear — ghost hides plans, not membership.
    expect(roster.map((e) => e.userId).sort((a, b) => a - b)).toEqual([101, 202]);

    const a = roster.find((e) => e.userId === 101);
    const b = roster.find((e) => e.userId === 202);
    expect(a?.plans.length).toBe(2);
    // The discriminative assertion: a ghost member's plans are absent server-side.
    expect(b?.ghost).toBe(true);
    expect(b?.plans).toEqual([]);

    // Plans resolved against the baked schedule (title/start present, sorted by start).
    expect(a?.plans.map((p) => p.occurrenceId)).toEqual([X, Y]);
    expect(a?.plans[0]?.title).toBeDefined();
    expect(a?.plans[0]?.start).toBeDefined();
  });

  it('ghost flag is load-bearing AND reversible (stars still synced underneath)', async () => {
    const crew = env.CREW.getByName('roster-flip');
    await crew.syncMember(1, 'Al', false, [X, Y]);
    expect((await crew.getRoster())[0]?.plans.length).toBe(2);

    // Flip ON → redacted to [].
    await crew.syncMember(1, 'Al', true, [X, Y]);
    expect((await crew.getRoster())[0]?.plans).toEqual([]);

    // Prove the stars were NOT discarded while ghosted — they're still in member_star.
    await runInDurableObject(crew, (_i, state) => {
      const rows = state.storage.sql
        .exec('SELECT occurrence_id FROM member_star WHERE user_id = 1')
        .toArray();
      expect(rows.length).toBe(2);
    });

    // Flip OFF → plans reappear (reversible), proving the boolean drove redaction.
    await crew.syncMember(1, 'Al', false, [X, Y]);
    expect((await crew.getRoster())[0]?.plans.length).toBe(2);
  });

  it('syncMember REPLACES the star set (not append)', async () => {
    const crew = env.CREW.getByName('roster-replace');
    await crew.syncMember(5, 'Cy', false, [X, Y]);
    await crew.syncMember(5, 'Cy', false, [Y]);

    const plans = (await crew.getRoster())[0]?.plans ?? [];
    expect(plans.map((p) => p.occurrenceId)).toEqual([Y]);
  });

  it('leaveCrew removes ONLY that member, leaving others intact', async () => {
    const crew = env.CREW.getByName('roster-leave');
    await crew.syncMember(1, 'Alice', false, [X, Y]);
    await crew.syncMember(2, 'Bob', false, [Z]);

    await crew.leaveCrew(1);

    const roster = await crew.getRoster();
    expect(roster.map((e) => e.userId)).toEqual([2]);
    const bob = roster.find((e) => e.userId === 2);
    expect(bob?.plans.map((p) => p.occurrenceId)).toEqual([Z]);

    // A's rows are fully gone (privacy) — no orphaned stars left behind.
    await runInDurableObject(crew, (_i, state) => {
      const starRows = state.storage.sql
        .exec('SELECT * FROM member_star WHERE user_id = 1')
        .toArray();
      const memberRows = state.storage.sql
        .exec('SELECT * FROM crew_member WHERE user_id = 1')
        .toArray();
      expect(starRows.length).toBe(0);
      expect(memberRows.length).toBe(0);
    });
  });

  it('two members starring the SAME occurrence both appear (no PK collision)', async () => {
    const crew = env.CREW.getByName('roster-shared');
    await crew.syncMember(1, 'Alice', false, [X]);
    await crew.syncMember(2, 'Bob', false, [X]);

    const roster = await crew.getRoster();
    expect(roster.length).toBe(2);
    for (const e of roster) {
      expect(e.plans.map((p) => p.occurrenceId)).toEqual([X]);
    }
  });

  it('non-finite user ids are ignored defensively', async () => {
    const crew = env.CREW.getByName('roster-badid');
    await crew.syncMember(Number.NaN, 'Nope', false, [X]);
    expect(await crew.getRoster()).toEqual([]);
  });
});

// End-to-end through the REAL Worker fetch (SELF), using valid signed initData —
// this exercises the /api/sync validation guards, not just the DO RPC. The
// Worker names the DO by String(chatId), so each distinct chatId is a fresh crew.
describe('POST /api/sync — validation guards (real fetch)', () => {
  it('valid sync (ghost:false, stars:[...]) → 200 and plans land end-to-end', async () => {
    const CHAT = 900001;
    const UID = 42;
    const res = await post('/api/sync', {
      initData: await freshInitData(UID),
      chatId: CHAT,
      ghost: false,
      stars: [X, Y],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const { roster } = await rosterFor(CHAT, UID);
    const me = roster.find((e) => e.userId === UID);
    expect(me?.ghost).toBe(false);
    expect(me?.plans.map((p) => p.occurrenceId)).toEqual([X, Y]);
  });

  it('ghost OMITTED → 400 and does NOT un-ghost an already-ghosted member', async () => {
    const CHAT = 900002;
    const UID = 42;
    // Pre-ghost the member via a VALID sync (ghost:true) with real stars underneath.
    const pre = await post('/api/sync', {
      initData: await freshInitData(UID),
      chatId: CHAT,
      ghost: true,
      stars: [X, Y],
    });
    expect(pre.status).toBe(200);
    // Sanity: ghosted, so plans are redacted to [] on the wire.
    const before = await rosterFor(CHAT, UID);
    const meBefore = before.roster.find((e) => e.userId === UID);
    expect(meBefore?.ghost).toBe(true);
    expect(meBefore?.plans).toEqual([]);

    // Now a sync that OMITS ghost must be rejected — never silently un-ghost.
    const res = await post('/api/sync', {
      initData: await freshInitData(UID),
      chatId: CHAT,
      stars: [X, Y],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'ghost must be a boolean' });

    // CRITICAL: the member is STILL ghosted — no un-ghosting occurred, so plans
    // remain redacted to []. This is the privacy-hole regression assertion.
    const after = await rosterFor(CHAT, UID);
    const meAfter = after.roster.find((e) => e.userId === UID);
    expect(meAfter?.ghost).toBe(true);
    expect(meAfter?.plans).toEqual([]);
  });

  it('non-boolean ghost → 400', async () => {
    const res = await post('/api/sync', {
      initData: await freshInitData(42),
      chatId: 900003,
      ghost: 'yes',
      stars: [X],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'ghost must be a boolean' });
  });

  it('stars OMITTED → 400 and existing stars are untouched (no wipe)', async () => {
    const CHAT = 900004;
    const UID = 42;
    // Seed a visible member with two stars.
    const seed = await post('/api/sync', {
      initData: await freshInitData(UID),
      chatId: CHAT,
      ghost: false,
      stars: [X, Y],
    });
    expect(seed.status).toBe(200);

    // A sync missing `stars` must be rejected, NOT coerced to [] (which would wipe).
    const res = await post('/api/sync', {
      initData: await freshInitData(UID),
      chatId: CHAT,
      ghost: false,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'stars must be an array' });

    // Existing stars survive untouched — the accidental-wipe regression assertion.
    const { roster } = await rosterFor(CHAT, UID);
    const me = roster.find((e) => e.userId === UID);
    expect(me?.plans.map((p) => p.occurrenceId)).toEqual([X, Y]);
  });

  it('non-array stars → 400 (but explicit empty [] stays valid)', async () => {
    const CHAT = 900005;
    const UID = 42;
    const bad = await post('/api/sync', {
      initData: await freshInitData(UID),
      chatId: CHAT,
      ghost: false,
      stars: 'nope',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'stars must be an array' });

    // An explicit empty array is an intentional clear — still accepted.
    const ok = await post('/api/sync', {
      initData: await freshInitData(UID),
      chatId: CHAT,
      ghost: false,
      stars: [],
    });
    expect(ok.status).toBe(200);
    const { roster } = await rosterFor(CHAT, UID);
    const me = roster.find((e) => e.userId === UID);
    expect(me?.plans).toEqual([]);
  });
});
