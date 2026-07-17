import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// ── Valid-initData signing (mirrors crew-roster.test.ts) ─────────────────────
// The pool binds BOT_TOKEN='test-bot-token' (vitest.workers.config.ts), so a blob
// signed with this token verifies through the real Worker fetch path.
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

interface EventView {
  eventId: string;
  ownerId: number;
  title: string;
  location: string | null;
  cancelled: boolean;
  starCount: number;
  viewerStarred?: boolean;
  isOwner?: boolean;
}

// These tests exercise the REAL Durable Object via the workers pool (miniflare).
// Custom-event RPCs touch no Telegram API, so no fetch stub is needed.

describe('Crew custom events — DO level', () => {
  it('createEvent then listEvents shows it (cancelled:false, isOwner:true for owner)', async () => {
    const crew = env.CREW.getByName('ce-create');
    const created = await crew.createEvent(101, { title: 'Room Party', location: 'Rm 1412' });
    expect(created.eventId).toBeTruthy();
    expect(created.ownerId).toBe(101);
    expect(created.cancelled).toBe(false);
    expect(created.location).toBe('Rm 1412');

    const events = await crew.listEvents(101);
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.eventId).toBe(created.eventId);
    expect(e.title).toBe('Room Party');
    expect(e.cancelled).toBe(false);
    expect(e.isOwner).toBe(true);
    expect(e.starCount).toBe(0);
    expect(e.viewerStarred).toBe(false);
  });

  it('createEvent with empty/blank title throws', async () => {
    const crew = env.CREW.getByName('ce-badtitle');
    // createEvent is synchronous SQL, so assert the throw on the instance directly
    // (crossing the JSRPC boundary with ONLY rejecting calls trips the pool's
    // isolated-storage stack — nothing ever commits into the DO).
    await runInDurableObject(crew, (instance) => {
      expect(() => instance.createEvent(1, { title: '   ' })).toThrow();
      expect(() => instance.createEvent(1, {})).toThrow();
    });
  });

  it('OWNER-ONLY: a non-owner editEvent/cancelEvent THROWS and does not mutate', async () => {
    const crew = env.CREW.getByName('ce-owneronly');
    // The RPCs are synchronous, so assert the owner-only throw on the instance
    // directly — a rejecting cross-JSRPC call trips the pool's isolated storage.
    await runInDurableObject(crew, (instance) => {
      const ev = instance.createEvent(1, { title: 'Dinner', location: 'Lobby' });

      // A different user cannot edit or cancel.
      expect(() => instance.editEvent(2, ev.eventId, { title: 'HACKED' })).toThrow();
      expect(() => instance.cancelEvent(2, ev.eventId)).toThrow();

      // The row is untouched: still the original title, still not cancelled.
      const after = instance.listEvents()[0]!;
      expect(after.title).toBe('Dinner');
      expect(after.cancelled).toBe(false);

      // The owner CAN edit.
      const edited = instance.editEvent(1, ev.eventId, { title: 'Group Dinner' });
      expect(edited.title).toBe('Group Dinner');
    });
  });

  it('editing a cancelled event throws (cancel is terminal)', async () => {
    const crew = env.CREW.getByName('ce-editcancelled');
    await runInDurableObject(crew, (instance) => {
      const ev = instance.createEvent(1, { title: 'Meetup' });
      instance.cancelEvent(1, ev.eventId);
      expect(() => instance.editEvent(1, ev.eventId, { title: 'Reopen' })).toThrow();
    });
  });

  it('cancelEvent sets cancelled:true and the event STILL appears (not deleted)', async () => {
    const crew = env.CREW.getByName('ce-cancel');
    const ev = await crew.createEvent(1, { title: 'Party', location: 'Rm 9' });
    // A starrer stars it, so the [CANCELLED]-not-vanish guarantee is meaningful.
    await crew.starEvent(2, ev.eventId);

    await crew.cancelEvent(1, ev.eventId);
    // Idempotent: cancelling again is a harmless no-op.
    await crew.cancelEvent(1, ev.eventId);

    const events = await crew.listEvents(2);
    expect(events.length).toBe(1); // NOT deleted — still visible
    expect(events[0]!.cancelled).toBe(true);
    expect(events[0]!.starCount).toBe(1);
    expect(events[0]!.viewerStarred).toBe(true);

    // Prove at the raw-table level the row survives with cancelled=1.
    await runInDurableObject(crew, (_i, state) => {
      const rows = state.storage.sql
        .exec('SELECT cancelled FROM custom_event WHERE event_id = ?', ev.eventId)
        .toArray() as { cancelled: number }[];
      expect(rows.length).toBe(1);
      expect(rows[0]!.cancelled).toBe(1);
    });
  });

  it('starEvent/unstarEvent adjusts starCount and viewerStarred; star of nonexistent throws', async () => {
    const crew = env.CREW.getByName('ce-star');
    const ev = await crew.createEvent(1, { title: 'Karaoke' });

    await crew.starEvent(2, ev.eventId);
    await crew.starEvent(3, ev.eventId);
    // Duplicate star is a no-op (INSERT OR IGNORE).
    await crew.starEvent(2, ev.eventId);

    let view = (await crew.listEvents(2))[0]!;
    expect(view.starCount).toBe(2);
    expect(view.viewerStarred).toBe(true);

    // Viewer 4 hasn't starred.
    view = (await crew.listEvents(4))[0]!;
    expect(view.viewerStarred).toBe(false);

    await crew.unstarEvent(2, ev.eventId);
    view = (await crew.listEvents(2))[0]!;
    expect(view.starCount).toBe(1);
    expect(view.viewerStarred).toBe(false);

    // Starring an event that does not exist throws (assert on the instance to keep
    // the rejection off the JSRPC boundary).
    await runInDurableObject(crew, (instance) => {
      expect(() => instance.starEvent(2, 'no-such-event')).toThrow();
    });
  });

  // ── bgx.1 acceptance (load-bearing) ────────────────────────────────────────
  it('leave (DEFAULT) NEVER cancels an event another member starred', async () => {
    const crew = env.CREW.getByName('ce-leave-default');
    // User A creates an event; user B stars it.
    const ev = await crew.createEvent(1, { title: 'A Party', location: 'Rm 100' });
    await crew.starEvent(2, ev.eventId);

    // A also stars something and is a crew member, to prove leave clears A's OWN stars.
    await crew.syncMember(1, 'Alice', false, []);
    await crew.starEvent(1, ev.eventId);

    // A leaves with DEFAULT opts (no flag).
    await crew.leaveCrew(1);

    // B still sees A's event, and it is NOT cancelled — leaving did not destroy it.
    const events = await crew.listEvents(2);
    expect(events.length).toBe(1);
    expect(events[0]!.eventId).toBe(ev.eventId);
    expect(events[0]!.cancelled).toBe(false);
    // B's star survived; A's own star was removed (starCount drops from 2 → 1).
    expect(events[0]!.starCount).toBe(1);
    expect(events[0]!.viewerStarred).toBe(true);

    // Raw-table readback: A's ownership row still exists, A's star row is gone.
    await runInDurableObject(crew, (_i, state) => {
      const owned = state.storage.sql
        .exec('SELECT cancelled FROM custom_event WHERE owner_id = 1')
        .toArray() as { cancelled: number }[];
      expect(owned.length).toBe(1);
      expect(owned[0]!.cancelled).toBe(0); // NOT cancelled by a default leave
      const aStar = state.storage.sql
        .exec('SELECT * FROM custom_event_star WHERE user_id = 1')
        .toArray();
      expect(aStar.length).toBe(0); // A's own star removed
      const bStar = state.storage.sql
        .exec('SELECT * FROM custom_event_star WHERE user_id = 2')
        .toArray();
      expect(bStar.length).toBe(1); // B's star untouched
    });
  });

  it('leave { cancelOwnEvents:true } cancels ONLY the leaver\'s events (still visible)', async () => {
    const crew = env.CREW.getByName('ce-leave-flag');
    const aEv = await crew.createEvent(1, { title: 'A Party' });
    const bEv = await crew.createEvent(2, { title: 'B Party' });
    await crew.starEvent(3, aEv.eventId);
    await crew.starEvent(3, bEv.eventId);

    // A leaves WITH the flag.
    await crew.leaveCrew(1, { cancelOwnEvents: true });

    const events = await crew.listEvents(3);
    const a = events.find((e) => e.eventId === aEv.eventId)!;
    const b = events.find((e) => e.eventId === bEv.eventId)!;
    // A's event is cancelled but STILL visible ([CANCELLED]); B's is untouched.
    expect(a.cancelled).toBe(true);
    expect(b.cancelled).toBe(false);
    // Affects ONLY A's events.
    expect(events.length).toBe(2);
    expect(a.starCount).toBe(1); // starrer still sees it
  });

  it('leave removes the leaver OWN stars but not their ownership of others-starred events', async () => {
    const crew = env.CREW.getByName('ce-leave-ownership');
    const ev = await crew.createEvent(1, { title: 'Shared' });
    await crew.starEvent(1, ev.eventId); // owner stars own event
    await crew.starEvent(2, ev.eventId); // another member stars it

    await crew.leaveCrew(1); // default: no cancel

    await runInDurableObject(crew, (_i, state) => {
      // Ownership row survives.
      const owned = state.storage.sql
        .exec('SELECT * FROM custom_event WHERE owner_id = 1')
        .toArray();
      expect(owned.length).toBe(1);
      // Leaver's star gone, other member's star intact.
      const leaverStars = state.storage.sql
        .exec('SELECT * FROM custom_event_star WHERE user_id = 1')
        .toArray();
      expect(leaverStars.length).toBe(0);
      const otherStars = state.storage.sql
        .exec('SELECT * FROM custom_event_star WHERE user_id = 2')
        .toArray();
      expect(otherStars.length).toBe(1);
    });
  });

  it('NO map/coordinate fields — the custom_event schema is free-text location only', async () => {
    const crew = env.CREW.getByName('ce-schema');
    await crew.createEvent(1, { title: 'x' });
    await runInDurableObject(crew, (_i, state) => {
      const cols = (
        state.storage.sql.exec('PRAGMA table_info(custom_event)').toArray() as { name: string }[]
      ).map((c) => c.name);
      // Free-text location exists…
      expect(cols).toContain('location');
      // …and NOTHING coordinate/map-shaped does.
      for (const banned of ['lat', 'lng', 'latitude', 'longitude', 'pin', 'coords', 'map']) {
        expect(cols).not.toContain(banned);
      }
    });
  });
});

// End-to-end through the REAL Worker fetch (SELF) with valid signed initData.
describe('POST /api/events/* — endpoint guards (real fetch)', () => {
  it('create → list round-trips end-to-end (owner view)', async () => {
    const CHAT = 910001;
    const UID = 42;
    const created = await post('/api/events/create', {
      initData: await freshInitData(UID),
      chatId: CHAT,
      title: 'Rooftop',
      location: 'Rm 1412',
    });
    expect(created.status).toBe(200);
    const { event } = await created.json<{ event: EventView }>();
    expect(event.title).toBe('Rooftop');
    expect(event.location).toBe('Rm 1412');
    expect(event.ownerId).toBe(UID);

    const listed = await post('/api/events/list', { initData: await freshInitData(UID), chatId: CHAT });
    expect(listed.status).toBe(200);
    const { events } = await listed.json<{ events: EventView[] }>();
    expect(events.length).toBe(1);
    expect(events[0]!.isOwner).toBe(true);
  });

  it('empty title → 400', async () => {
    const res = await post('/api/events/create', {
      initData: await freshInitData(42),
      chatId: 910002,
      title: '   ',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'title required' });
  });

  it('a non-owner cancel → 403 (owner-only), event stays visible & uncancelled', async () => {
    const CHAT = 910003;
    const OWNER = 42;
    const OTHER = 99;
    const created = await post('/api/events/create', {
      initData: await freshInitData(OWNER),
      chatId: CHAT,
      title: 'Owned',
    });
    const { event } = await created.json<{ event: EventView }>();

    const res = await post('/api/events/cancel', {
      initData: await freshInitData(OTHER),
      chatId: CHAT,
      eventId: event.eventId,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not owner' });

    // Still present and NOT cancelled.
    const listed = await post('/api/events/list', { initData: await freshInitData(OWNER), chatId: CHAT });
    const { events } = await listed.json<{ events: EventView[] }>();
    expect(events[0]!.cancelled).toBe(false);
  });

  it('star endpoint toggles the viewer star; bad body → 400', async () => {
    const CHAT = 910004;
    const OWNER = 42;
    const VIEWER = 7;
    const created = await post('/api/events/create', {
      initData: await freshInitData(OWNER),
      chatId: CHAT,
      title: 'Starrable',
    });
    const { event } = await created.json<{ event: EventView }>();

    const starred = await post('/api/events/star', {
      initData: await freshInitData(VIEWER),
      chatId: CHAT,
      eventId: event.eventId,
      starred: true,
    });
    expect(starred.status).toBe(200);

    const listed = await post('/api/events/list', { initData: await freshInitData(VIEWER), chatId: CHAT });
    const { events } = await listed.json<{ events: EventView[] }>();
    expect(events[0]!.starCount).toBe(1);
    expect(events[0]!.viewerStarred).toBe(true);

    // Missing `starred` boolean → 400.
    const bad = await post('/api/events/star', {
      initData: await freshInitData(VIEWER),
      chatId: CHAT,
      eventId: event.eventId,
    });
    expect(bad.status).toBe(400);
  });

  it('malformed chatId → 400; bad initData → 401', async () => {
    const bad400 = await post('/api/events/list', {
      initData: await freshInitData(42),
      chatId: 'not-a-number',
    });
    expect(bad400.status).toBe(400);

    const bad401 = await post('/api/events/list', { initData: 'garbage', chatId: 910005 });
    expect(bad401.status).toBe(401);
  });
});
