import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';

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

/**
 * A fresh, validly-signed blob for a user. When `chatId` is given, the SIGNED
 * `chat` object carries the crew — that (not a body chatId) is how the Worker
 * now selects the crew, so it is part of the HMAC-protected data_check_string.
 */
async function freshInitData(userId: number, chatId?: number): Promise<string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAF-example',
    user: JSON.stringify({ id: userId, first_name: 'Robin', username: 'robin' }),
  };
  if (chatId !== undefined) {
    fields.chat = JSON.stringify({ id: chatId, type: 'supergroup' });
  }
  return signValid(fields, TOKEN);
}

/**
 * A validly-signed blob whose ONLY crew-shaped field is a SIGNED `start_param`
 * (no `chat`) — a Direct Link Mini App launch (`?startapp=<groupChatId>`).
 * start_param is user-chosen, so a valid HMAC is NOT authorization: the Worker
 * accepts it as a crew selector ONLY after a Telegram membership check
 * (getChatMember) confirms the acting user is really in that chat. A non-member,
 * a getChatMember error, or a non-integer start_param all fail closed.
 */
async function freshInitDataStartParamOnly(userId: number, startParam: string): Promise<string> {
  return signValid(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'AAF-example',
      user: JSON.stringify({ id: userId, first_name: 'Robin', username: 'robin' }),
      start_param: startParam,
    },
    TOKEN,
  );
}

/**
 * Stub global `fetch` so the Worker's `getChatMember` call resolves to a chosen
 * outcome. Returns the spy so a test can assert the membership call was (or was
 * NOT) made. Non-`getChatMember` Telegram calls (none in these tests) default to
 * `{ ok:true, result:true }`. `mode`:
 *   - a status string ('member' | 'left' | ...) → `{ ok:true, result:{ status } }`
 *   - 'api-error' → `{ ok:false }` (Bot API says not-ok)
 *   - 'reject'    → the fetch promise rejects (network error)
 */
function stubTelegram(mode: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn((input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (urlStr.includes('/getChatMember')) {
      if (mode === 'reject') return Promise.reject(new Error('network down'));
      if (mode === 'api-error') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, description: 'chat not found' }), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { status: mode } }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return fn;
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
  const res = await post('/api/roster', { initData: await freshInitData(userId, chatId) });
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
// this exercises the /api/sync validation guards, not just the DO RPC. The crew
// is now derived from the SIGNED `chat` in initData, so each distinct signed chat
// is a fresh crew and NO chatId is sent in the request body.
describe('POST /api/sync — validation guards (real fetch)', () => {
  it('valid sync (ghost:false, stars:[...]) → 200 and plans land end-to-end', async () => {
    const CHAT = 900001;
    const UID = 42;
    const res = await post('/api/sync', {
      initData: await freshInitData(UID, CHAT),
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
      initData: await freshInitData(UID, CHAT),
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
      initData: await freshInitData(UID, CHAT),
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
      initData: await freshInitData(42, 900003),
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
      initData: await freshInitData(UID, CHAT),
      ghost: false,
      stars: [X, Y],
    });
    expect(seed.status).toBe(200);

    // A sync missing `stars` must be rejected, NOT coerced to [] (which would wipe).
    const res = await post('/api/sync', {
      initData: await freshInitData(UID, CHAT),
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
      initData: await freshInitData(UID, CHAT),
      ghost: false,
      stars: 'nope',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'stars must be an array' });

    // An explicit empty array is an intentional clear — still accepted.
    const ok = await post('/api/sync', {
      initData: await freshInitData(UID, CHAT),
      ghost: false,
      stars: [],
    });
    expect(ok.status).toBe(200);
    const { roster } = await rosterFor(CHAT, UID);
    const me = roster.find((e) => e.userId === UID);
    expect(me?.plans).toEqual([]);
  });
});

// Crew SELECTION now comes from the HMAC-verified initData, never the body. These
// tests pin that contract: the security discriminator, the "no crew source" case,
// and cross-chat isolation via two distinct signed chats.
describe('POST /api/sync — crew is derived from SIGNED initData (security)', () => {
  it('SECURITY: a body chatId for crew B is IGNORED; the op lands in the SIGNED crew A only', async () => {
    const CREW_A = 950101;
    const CREW_B = 950102;
    const UID = 77;

    // initData is SIGNED for crew A, but the body ALSO carries chatId = crew B.
    // The Worker must ignore body.chatId entirely and operate on crew A.
    const res = await post('/api/sync', {
      initData: await freshInitData(UID, CREW_A),
      chatId: CREW_B, // attacker-supplied cross-crew selector — must be ignored
      ghost: false,
      stars: [X, Y],
    });
    expect(res.status).toBe(200);

    // Crew A (the SIGNED crew) received the member + stars.
    const inA = await rosterFor(CREW_A, UID);
    const meA = inA.roster.find((e) => e.userId === UID);
    expect(meA?.plans.map((p) => p.occurrenceId)).toEqual([X, Y]);

    // Crew B (the body chatId) was NEVER touched — the user/stars did not land there.
    const inB = await rosterFor(CREW_B, UID);
    expect(inB.roster.find((e) => e.userId === UID)).toBeUndefined();
    expect(inB.roster).toEqual([]);
  });

  it('initData with NEITHER chat NOR start_param → 400 cannot determine crew', async () => {
    const res = await post('/api/sync', {
      initData: await freshInitData(42), // no chatId → no signed chat
      ghost: false,
      stars: [X],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'cannot determine crew from initData' });
  });

  it('start_param that is NOT a valid chat-id integer (and no chat) → 400', async () => {
    // A non-integer start_param can never be a Telegram chat id, so it is not a
    // crew selector at all — reject before any membership call.
    const res = await post('/api/sync', {
      initData: await freshInitDataStartParamOnly(42, 'abc'),
      ghost: false,
      stars: [X],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'cannot determine crew from initData' });
  });

  it('two different SIGNED chats are two isolated crews', async () => {
    const CREW_1 = 950201;
    const CREW_2 = 950202;

    await post('/api/sync', {
      initData: await freshInitData(1, CREW_1),
      ghost: false,
      stars: [X],
    });
    await post('/api/sync', {
      initData: await freshInitData(2, CREW_2),
      ghost: false,
      stars: [Y],
    });

    const one = await rosterFor(CREW_1, 1);
    const two = await rosterFor(CREW_2, 2);
    expect(one.roster.map((e) => e.userId)).toEqual([1]);
    expect(two.roster.map((e) => e.userId)).toEqual([2]);
    // Neither crew leaked into the other.
    expect(one.roster.find((e) => e.userId === 2)).toBeUndefined();
    expect(two.roster.find((e) => e.userId === 1)).toBeUndefined();
  });
});

// A Direct Link Mini App launch (t.me/<bot>/<app>?startapp=<groupChatId>) delivers
// the crew id in the SIGNED `start_param`, NOT in `chat`. start_param is
// user-chosen, so it is authorized ONLY by a live Telegram membership check
// (getChatMember). These tests stub that Bot API call and pin: member → allowed,
// everything else (non-member OR getChatMember error) → 403 fail-closed, while the
// trusted `chat.id` path never makes the call.
describe('POST /api/sync — direct-link start_param is membership-verified', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const called = (fn: ReturnType<typeof vi.fn>): boolean =>
    fn.mock.calls.some((args) => {
      const input = args[0] as RequestInfo | URL;
      const urlStr =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return urlStr.includes('/getChatMember');
    });

  it('direct-link + active member → 200 and the user lands in that crew roster', async () => {
    const CREW = 960001;
    const UID = 501;
    const fetchSpy = stubTelegram('member');

    const res = await post('/api/sync', {
      initData: await freshInitDataStartParamOnly(UID, String(CREW)),
      ghost: false,
      stars: [X, Y],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The membership check WAS performed for the untrusted start_param path.
    expect(called(fetchSpy)).toBe(true);

    // The user really landed in the crew named by the start_param.
    const { roster } = await rosterFor(CREW, UID);
    const me = roster.find((e) => e.userId === UID);
    expect(me?.plans.map((p) => p.occurrenceId)).toEqual([X, Y]);
  });

  it('direct-link + NON-member (left) → 403 and the user does NOT land', async () => {
    const CREW = 960002;
    const UID = 502;
    stubTelegram('left');

    const res = await post('/api/sync', {
      initData: await freshInitDataStartParamOnly(UID, String(CREW)),
      ghost: false,
      stars: [X, Y],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not a member of this crew' });

    // Fail-closed: nothing was written, the crew roster is unchanged (empty).
    const { roster } = await rosterFor(CREW, UID);
    expect(roster).toEqual([]);
  });

  it('direct-link + kicked → 403 (another inactive status)', async () => {
    const CREW = 960003;
    const UID = 503;
    stubTelegram('kicked');

    const res = await post('/api/sync', {
      initData: await freshInitDataStartParamOnly(UID, String(CREW)),
      ghost: false,
      stars: [X],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not a member of this crew' });
  });

  it('direct-link + getChatMember Bot API error (ok:false) → 403 (fail closed)', async () => {
    const CREW = 960004;
    const UID = 504;
    stubTelegram('api-error');

    const res = await post('/api/sync', {
      initData: await freshInitDataStartParamOnly(UID, String(CREW)),
      ghost: false,
      stars: [X],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not a member of this crew' });

    const { roster } = await rosterFor(CREW, UID);
    expect(roster).toEqual([]);
  });

  it('direct-link + getChatMember network rejection → 403 (fail closed, never throws 500)', async () => {
    const CREW = 960005;
    const UID = 505;
    stubTelegram('reject');

    const res = await post('/api/sync', {
      initData: await freshInitDataStartParamOnly(UID, String(CREW)),
      ghost: false,
      stars: [X],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not a member of this crew' });
  });

  it('attachment-menu (signed chat.id) still works WITHOUT any membership call', async () => {
    const CHAT = 960006;
    const UID = 506;
    const fetchSpy = stubTelegram('left'); // would DENY if it were ever consulted

    const res = await post('/api/sync', {
      initData: await freshInitData(UID, CHAT), // signed chat.id → trusted path
      ghost: false,
      stars: [X, Y],
    });
    expect(res.status).toBe(200);
    // The trusted path must NOT consult getChatMember — assert it was skipped.
    expect(called(fetchSpy)).toBe(false);

    const { roster } = await rosterFor(CHAT, UID);
    const me = roster.find((e) => e.userId === UID);
    expect(me?.plans.map((p) => p.occurrenceId)).toEqual([X, Y]);
  });
});

// The display name may be a CLIENT-chosen custom name (sanitized), falling back
// to the verified Telegram name (first_name 'Robin') when blank/absent.
describe('POST /api/sync — custom display name', () => {
  async function nameInRoster(chatId: number, userId: number): Promise<string> {
    const res = await post('/api/roster', { initData: await freshInitData(userId, chatId) });
    expect(res.status).toBe(200);
    const { roster } = await res.json<{
      roster: { userId: number; displayName: string }[];
    }>();
    const me = roster.find((m) => m.userId === userId);
    expect(me).toBeDefined();
    return me?.displayName ?? '';
  }

  it('stores a trimmed custom displayName and returns it in the roster', async () => {
    const CHAT = 970001;
    const UID = 55;
    const res = await post('/api/sync', {
      initData: await freshInitData(UID, CHAT),
      ghost: false,
      stars: [],
      displayName: '  Zinnia  ',
    });
    expect(res.status).toBe(200);
    expect(await nameInRoster(CHAT, UID)).toBe('Zinnia');
  });

  it('falls back to the Telegram name when displayName is blank', async () => {
    const CHAT = 970002;
    const UID = 56;
    await post('/api/sync', {
      initData: await freshInitData(UID, CHAT),
      ghost: false,
      stars: [],
      displayName: '   ',
    });
    expect(await nameInRoster(CHAT, UID)).toBe('Robin');
  });

  it('falls back to the Telegram name when displayName is omitted', async () => {
    const CHAT = 970003;
    const UID = 57;
    await post('/api/sync', {
      initData: await freshInitData(UID, CHAT),
      ghost: false,
      stars: [],
    });
    expect(await nameInRoster(CHAT, UID)).toBe('Robin');
  });
});
