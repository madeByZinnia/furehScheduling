import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveCrewRef, type TelegramUpdate } from '../../src/worker/telegram';
import { parseSetCon, applyUpdate } from '../../src/worker/index';

// Tic 5: each Crew DO serves ITS con — it stores con_id, loads that con's schedule
// at runtime (KV→asset, no baked import), and renders the digest in the con's
// timezone. These tests are DISCRIMINATIVE: a DO that still read baked Fureh data
// would show Fureh titles / Edmonton times and FAIL the ToS assertions below.

interface BotCall {
  method: string;
  body: Record<string, unknown>;
}
let calls: BotCall[];

// The membership status the stubbed getChatMember reports (per test). 'api-error'
// makes the Bot API answer not-ok, so the Worker fails closed.
let chatMemberStatus = 'member';

// Stub global fetch: capture Telegram Bot API calls (no network in the pool) and
// answer sendMessage with a message id, getChatMember with the chosen membership.
function stubTelegramFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = urlStr.split('/').pop() ?? '';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ method, body });
    if (method === 'getChatMember' && chatMemberStatus === 'api-error') {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, description: 'chat not found' }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    let result: unknown = true;
    if (method === 'sendMessage') {
      result = { message_id: 1000 + calls.filter((c) => c.method === 'sendMessage').length };
    } else if (method === 'getChatMember') {
      result = { status: chatMemberStatus };
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

function count(method: string): number {
  return calls.filter((c) => c.method === method).length;
}

function sentText(): string {
  const send = calls.find((c) => c.method === 'sendMessage');
  expect(send).toBeDefined();
  return send?.body.text as string;
}

/** A minimal con schedule JSON string with a single known occurrence. */
function scheduleJson(occ: { id: string; title: string; room: string | null; start: string; end: string }): string {
  return JSON.stringify({ generatedAt: 'multi-con-test', occurrences: [occ] });
}

beforeEach(() => {
  calls = [];
  chatMemberStatus = 'member';
  vi.stubGlobal('fetch', stubTelegramFetch());
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await env.SCHEDULES.delete('tos');
});

describe('Crew serves its own con — con-aware digest', () => {
  it('con=tos renders a ToS title in Vancouver time (KV path)', async () => {
    // Seed KV so the load is deterministic (Tic 3 KV-first pattern). The occurrence
    // starts 10:00 Pacific; a bug that rendered Edmonton time would show 11:00.
    await env.SCHEDULES.put(
      'tos',
      scheduleJson({
        id: 'HCT@2026-08-08T10:00:00-07:00',
        title: 'Hosting community technology',
        room: 'Carvers - Panel 1',
        start: '2026-08-08T10:00:00-07:00',
        end: '2026-08-08T11:00:00-07:00',
      }),
    );
    const crew = env.CREW.getByName('mc-tos-kv');
    await crew.configure(5001, 'tos');
    // now = 09:30 Pacific → the occurrence is UPCOMING, so its start time is shown.
    await crew.postDigest(Date.parse('2026-08-08T09:30:00-07:00'));

    const text = sentText();
    expect(text).toContain('Hosting community technology');
    // Vancouver (PDT) is 10:00; the Edmonton (MDT) rendering would be 11:00.
    expect(text).toContain('10:00 Hosting community technology');
    expect(text).not.toContain('11:00');
  });

  it('con=tos falls back to the tos asset on a KV miss (no baked Fureh leak)', async () => {
    await env.SCHEDULES.delete('tos'); // force the ASSETS fallback to public/data/tos.json
    const crew = env.CREW.getByName('mc-tos-asset');
    await crew.configure(5002, 'tos');
    // now during the first real ToS occurrence (10:00–11:00 Pacific).
    await crew.postDigest(Date.parse('2026-08-08T10:30:00-07:00'));

    const text = sentText();
    // Real ToS data loaded via the asset fallback → a real ToS title appears...
    expect(text).toContain('Hosting community technology');
    // ...and NO baked Fureh title leaks (the module import is gone).
    expect(text).not.toContain('Opening Ceremonies');
  });
});

describe('crew_config.con_id migration', () => {
  it('backfills con_id=fureh on a pre-Tic-5 crew_config row (no data migration)', async () => {
    const crew = env.CREW.getByName('mc-migrate');
    await runInDurableObject(crew, (instance, state) => {
      // Simulate a pre-Tic-5 DB: recreate crew_config WITHOUT con_id, holding a
      // live crew row (chat bound, no con column at all).
      state.storage.sql.exec('DROP TABLE crew_config');
      state.storage.sql.exec(
        `CREATE TABLE crew_config (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           chat_id INTEGER,
           pinned_message_id INTEGER,
           is_admin INTEGER NOT NULL DEFAULT 0
         )`,
      );
      state.storage.sql.exec('INSERT INTO crew_config (id, chat_id, is_admin) VALUES (1, 555, 0)');

      // Re-run the constructor's migration guard.
      (instance as unknown as { ensureConColumn(): void }).ensureConColumn();

      const row = state.storage.sql
        .exec<{ chat_id: number; con_id: string }>(
          'SELECT chat_id, con_id FROM crew_config WHERE id = 1',
        )
        .one();
      // The NOT NULL DEFAULT 'fureh' backfilled the existing row; chat_id survives.
      expect(row.chat_id).toBe(555);
      expect(row.con_id).toBe('fureh');
    });
  });
});

describe('setCon', () => {
  it('switches the con; an unknown con is rejected and leaves the con unchanged', async () => {
    const crew = env.CREW.getByName('mc-setcon');
    await crew.configure(5003, 'fureh');
    expect(await crew.con()).toBe('fureh');

    expect(await crew.setCon('tos')).toBe(true);
    expect(await crew.con()).toBe('tos');

    // Unknown con → rejected (false), con unchanged.
    expect(await crew.setCon('bogus')).toBe(false);
    expect(await crew.con()).toBe('tos');

    // A digest now reflects tos (seed KV for a deterministic marker title).
    await env.SCHEDULES.put(
      'tos',
      scheduleJson({
        id: 'MK@2026-08-08T10:00:00-07:00',
        title: 'Setcon marker session',
        room: null,
        start: '2026-08-08T10:00:00-07:00',
        end: '2026-08-08T11:00:00-07:00',
      }),
    );
    await crew.postDigest(Date.parse('2026-08-08T10:30:00-07:00'));
    expect(sentText()).toContain('Setcon marker session');
  });
});

describe('resolveCrewRef — con-tagged start_param (<conId>__<chatId>)', () => {
  const params = (fields: Record<string, string>): URLSearchParams => new URLSearchParams(fields);

  it('tos__<chatId> → the chat crew (untrusted) with a display-only con hint', () => {
    expect(resolveCrewRef(params({ start_param: 'tos__-1001234567' }))).toEqual({
      crewId: '-1001234567',
      trusted: false,
      conId: 'tos',
    });
  });

  it('legacy BARE <chatId> (no __) still resolves, with no con hint', () => {
    expect(resolveCrewRef(params({ start_param: '-1001234567' }))).toEqual({
      crewId: '-1001234567',
      trusted: false,
    });
  });

  it('the chat part after __ must be a safe integer — a bad chat part → null', () => {
    expect(resolveCrewRef(params({ start_param: 'tos__abc', query_id: 'x' }))).toBeNull();
  });

  it('NONCANONICAL numbers → null (the DO name would diverge from the verified chat)', () => {
    // Number('1e3')===1000 and Number('0x10')===16 are safe integers, but String()
    // does NOT round-trip them, so the DO named '1e3'/'0x10' would differ from the
    // membership-verified chat 1000/16. Reject them outright.
    expect(resolveCrewRef(params({ start_param: 'tos__1e3', query_id: 'x' }))).toBeNull();
    expect(resolveCrewRef(params({ start_param: 'tos__0x10', query_id: 'x' }))).toBeNull();
    // Leading-zero aliases and signed/plain zero also diverge under String(Number).
    expect(resolveCrewRef(params({ start_param: 'tos__001', query_id: 'x' }))).toBeNull();
    expect(resolveCrewRef(params({ start_param: 'tos__00', query_id: 'x' }))).toBeNull();
    expect(resolveCrewRef(params({ start_param: 'tos__-0', query_id: 'x' }))).toBeNull();
    expect(resolveCrewRef(params({ start_param: 'tos__0', query_id: 'x' }))).toBeNull();
    // A canonical negative decimal (a real group id) still resolves...
    expect(resolveCrewRef(params({ start_param: 'tos__-1001234567' }))).toEqual({
      crewId: '-1001234567',
      trusted: false,
      conId: 'tos',
    });
    // ...and canonical bare decimals still resolve.
    expect(resolveCrewRef(params({ start_param: '-100' }))).toEqual({
      crewId: '-100',
      trusted: false,
    });
    expect(resolveCrewRef(params({ start_param: '12345' }))).toEqual({
      crewId: '12345',
      trusted: false,
    });
  });
});

// The con hint changes ONLY parsing — the chat id (everything after the first __)
// is still the membership-verified selector. This end-to-end test signs a
// direct-link launch with a con-tagged start_param and asserts getChatMember is
// consulted for the CHAT PART, not the whole token.
describe('con-tagged start_param is still membership-verified (security)', () => {
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
  async function signStartParam(userId: number, startParam: string): Promise<string> {
    const fields: Record<string, string> = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'AAF-example',
      user: JSON.stringify({ id: userId, first_name: 'Robin', username: 'robin' }),
      start_param: startParam,
    };
    const dcs = Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const secret = await hmacRaw(enc.encode('WebAppData'), TOKEN);
    const hash = toHex(await hmacRaw(new Uint8Array(secret), dcs));
    const p = new URLSearchParams(fields);
    p.set('hash', hash);
    return p.toString();
  }

  it('membership-checks the chat part of tos__<chatId> and lands the user there', async () => {
    const CHAT = 970500;
    const UID = 601;
    const res = await SELF.fetch('https://example.com/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        initData: await signStartParam(UID, `tos__${CHAT}`),
        ghost: false,
        stars: [],
      }),
    });
    expect(res.status).toBe(200);
    // getChatMember was consulted for the CHAT PART (970500), not 'tos__970500'.
    const gcm = calls.find((c) => c.method === 'getChatMember');
    expect(gcm).toBeDefined();
    expect(gcm?.body.chat_id).toBe(CHAT);
  });
});

// FIX 1 (HIGH): /setcon is privileged — only a chat admin may change the crew's
// con. The gate lives in applyUpdate; call it DIRECTLY (awaiting the full
// getChatMember→setCon chain) so the assertion is deterministic, not racing a
// webhook waitUntil. The stubbed getChatMember reports `chatMemberStatus`.
describe('/setcon is admin-gated (authorization)', () => {
  function setconUpdate(chatId: number, userId: number, con: string): TelegramUpdate {
    return {
      update_id: 1,
      message: {
        chat: { id: chatId, type: 'supergroup' },
        from: { id: userId },
        text: `/setcon ${con}`,
      },
    };
  }

  it("an ADMIN sender's /setcon tos changes the con", async () => {
    chatMemberStatus = 'administrator';
    const CHAT = 980001;
    await applyUpdate(setconUpdate(CHAT, 42, 'tos'), env);
    expect(await env.CREW.getByName(String(CHAT)).con()).toBe('tos');
    // The privileged action WAS authorized via a live membership check.
    expect(count('getChatMember')).toBeGreaterThan(0);
  });

  it("the group CREATOR's /setcon tos also changes the con", async () => {
    chatMemberStatus = 'creator';
    const CHAT = 980002;
    await applyUpdate(setconUpdate(CHAT, 42, 'tos'), env);
    expect(await env.CREW.getByName(String(CHAT)).con()).toBe('tos');
  });

  it("a NON-admin (plain member) sender's /setcon tos does NOT change the con", async () => {
    chatMemberStatus = 'member';
    const CHAT = 980003;
    await applyUpdate(setconUpdate(CHAT, 42, 'tos'), env);
    // Ignored → the crew stays on its default con.
    expect(await env.CREW.getByName(String(CHAT)).con()).toBe('fureh');
  });

  it('a getChatMember error fails CLOSED — /setcon is ignored', async () => {
    chatMemberStatus = 'api-error';
    const CHAT = 980004;
    await applyUpdate(setconUpdate(CHAT, 42, 'tos'), env);
    expect(await env.CREW.getByName(String(CHAT)).con()).toBe('fureh');
  });
});

// FIX 3 (MED): a corrupt live KV override must NOT shadow a valid baked asset — it
// is treated as a miss and we fall through to /data/<con>.json. A WELL-FORMED but
// empty KV value is a legitimate hit and is served as-is (no fallthrough).
const TOS_DURING = Date.parse('2026-08-08T10:30:00-07:00'); // inside the first real ToS occ

async function digestWithKv(name: string, chatId: number, kvValue: string): Promise<string> {
  await env.SCHEDULES.put('tos', kvValue);
  const crew = env.CREW.getByName(name);
  await crew.configure(chatId, 'tos');
  await crew.postDigest(TOS_DURING);
  return sentText();
}

describe('malformed KV schedule falls through to the asset', () => {
  it('unparseable KV text ({) → the asset is served, not an empty schedule', async () => {
    const text = await digestWithKv('mc-kv-corrupt', 6301, '{');
    expect(text).toContain('Hosting community technology');
  });

  it('JSON null KV value → asset served (no TypeError escapes the fallthrough)', async () => {
    // Regression: parseSchedule used to do null.occurrences → TypeError, which blew
    // past the malformed-KV fallthrough. It must now be a clean miss.
    const text = await digestWithKv('mc-kv-null', 6302, 'null');
    expect(text).toContain('Hosting community technology');
  });

  it('garbage occurrences ([{}]) → asset served (junk never shadows a valid asset)', async () => {
    const text = await digestWithKv('mc-kv-garbage', 6303, '{"occurrences":[{}]}');
    expect(text).toContain('Hosting community technology');
  });

  it('well-formed EMPTY KV ({"occurrences":[]}) is a VALID hit — served, not fallthrough', async () => {
    // An empty-but-valid schedule wins over the asset: the digest is empty, proving
    // the KV value was used (the asset here would have shown a real occurrence).
    const text = await digestWithKv('mc-kv-empty', 6304, '{"occurrences":[]}');
    expect(text).toContain('Nothing scheduled right now.');
    expect(text).not.toContain('Hosting community technology');
  });
});

// FIX 4 (MED): a total load failure (no KV, no asset) must not overwrite the last
// good pinned digest, and getRoster must degrade rather than throw.
describe('schedule load failure is handled, not fatal', () => {
  it('loadSchedule THROWS on a double-miss (unknown con, no KV + no asset)', async () => {
    const crew = env.CREW.getByName('mc-doublemiss');
    await runInDurableObject(crew, async (instance) => {
      await expect(
        (instance as unknown as { loadSchedule(c: string): Promise<unknown> }).loadSchedule(
          'zzz-no-such-con',
        ),
      ).rejects.toThrow(/schedule load failed/);
    });
  });

  it('postDigest skips (preserving the pin) when the load fails — no clobbering edit', async () => {
    await env.SCHEDULES.put(
      'tos',
      scheduleJson({
        id: 'PIN@2026-08-08T10:00:00-07:00',
        title: 'Good pinned session',
        room: null,
        start: '2026-08-08T10:00:00-07:00',
        end: '2026-08-08T11:00:00-07:00',
      }),
    );
    const crew = env.CREW.getByName('mc-pin-preserve');
    await crew.configure(6401, 'tos');
    await runInDurableObject(crew, async (instance, state) => {
      // A good post creates the pin.
      await instance.postDigest(Date.parse('2026-08-08T10:30:00-07:00'));
      const pinned1 = state.storage.sql
        .exec<{ p: number | null }>('SELECT pinned_message_id AS p FROM crew_config WHERE id = 1')
        .one().p;
      expect(pinned1).not.toBeNull();
      const editsBefore = count('editMessageText');

      // Force a total load failure, then post again in a later bucket.
      (instance as unknown as { loadSchedule(c: string): Promise<unknown> }).loadSchedule = () =>
        Promise.reject(new Error('simulated total load failure'));
      await instance.postDigest(Date.parse('2026-08-08T11:05:00-07:00'));

      // The failed post did NOT edit the pin (no clobber) and left the id intact.
      expect(count('editMessageText')).toBe(editsBefore);
      const pinned2 = state.storage.sql
        .exec<{ p: number | null }>('SELECT pinned_message_id AS p FROM crew_config WHERE id = 1')
        .one().p;
      expect(pinned2).toBe(pinned1);
    });
  });

  it('getRoster DEGRADES (plans carry only occurrenceId) when the load fails', async () => {
    const crew = env.CREW.getByName('mc-roster-degrade');
    await crew.syncMember(1, 'Al', false, ['GGATRR@2026-07-16T17:00:00-06:00']);
    const roster = await runInDurableObject(crew, async (instance) => {
      (instance as unknown as { loadSchedule(c: string): Promise<unknown> }).loadSchedule = () =>
        Promise.reject(new Error('simulated total load failure'));
      return instance.getRoster();
    });
    // The member + plan still come back (no 500); the plan is un-enriched.
    const me = roster.find((e) => e.userId === 1);
    expect(me).toBeDefined();
    expect(me?.plans.map((p) => p.occurrenceId)).toEqual(['GGATRR@2026-07-16T17:00:00-06:00']);
    expect(me?.plans[0]?.title).toBeUndefined();
    expect(me?.plans[0]?.start).toBeUndefined();
  });
});

// The schedule cache is keyed by con id — a setCon must not serve the previous
// con's cached data.
describe('schedule cache is con-keyed', () => {
  it('load fureh, setCon tos → the next digest shows ToS data, not the cached Fureh', async () => {
    const crew = env.CREW.getByName('mc-cache-key');
    await crew.configure(6500, 'fureh');
    // Prime the cache with Fureh (asset load) — a mid-con Fureh instant.
    await crew.postDigest(Date.parse('2026-07-18T13:05:00-06:00'));

    // Switch con and seed a distinctive ToS marker.
    expect(await crew.setCon('tos')).toBe(true);
    await env.SCHEDULES.put(
      'tos',
      scheduleJson({
        id: 'CK@2026-08-08T10:00:00-07:00',
        title: 'Cache key ToS marker',
        room: null,
        start: '2026-08-08T10:00:00-07:00',
        end: '2026-08-08T11:00:00-07:00',
      }),
    );
    // A pin already exists → this post EDITS it; the edit must reflect ToS.
    await crew.postDigest(Date.parse('2026-08-08T10:30:00-07:00'));

    const edit = calls.filter((c) => c.method === 'editMessageText').at(-1);
    expect(edit).toBeDefined();
    const text = edit?.body.text as string;
    // Cache reloaded for the new con → ToS marker present, Fureh title absent.
    expect(text).toContain('Cache key ToS marker');
    expect(text).not.toContain('Opening Ceremonies');
  });
});

// The constructor migration guard must be idempotent.
describe('ensureConColumn migration guard is idempotent', () => {
  it('running twice is a no-op — exactly one con_id column, value intact', async () => {
    const crew = env.CREW.getByName('mc-migrate-twice');
    await runInDurableObject(crew, (instance, state) => {
      const guard = instance as unknown as { ensureConColumn(): void };
      // Fresh DB already has con_id; call the guard twice more.
      guard.ensureConColumn();
      guard.ensureConColumn();
      const conCols = state.storage.sql
        .exec<{ name: string }>('PRAGMA table_info(crew_config)')
        .toArray()
        .filter((c) => c.name === 'con_id');
      expect(conCols.length).toBe(1); // never duplicated, never threw
    });
  });
});

// parseSetCon parsing (pure function).
describe('parseSetCon', () => {
  it('parses /setcon and /con with an id', () => {
    expect(parseSetCon('/setcon tos')).toBe('tos');
    expect(parseSetCon('/con tos')).toBe('tos');
  });
  it('tolerates a bot-username suffix and surrounding whitespace', () => {
    expect(parseSetCon('/setcon@FurEhBot tos')).toBe('tos');
    expect(parseSetCon('   /setcon    canfurence  ')).toBe('canfurence');
    // Accepts ANY @bot suffix (not just ours) — acceptable now that /setcon is
    // admin-gated; the id is still validated against the con registry downstream.
    expect(parseSetCon('/setcon@SomeOtherBot tos')).toBe('tos');
  });
  it('returns null for non-commands, missing args, and near-misses', () => {
    expect(parseSetCon('hello world')).toBeNull();
    expect(parseSetCon('/setcon')).toBeNull();
    expect(parseSetCon('/setcontos')).toBeNull();
    expect(parseSetCon('/config foo')).toBeNull();
    expect(parseSetCon(undefined)).toBeNull();
  });
});
