import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { buildDigest, type DigestOccurrence } from './digest';
import {
  editMessageText,
  pinChatMessage,
  sendMessage,
  type InlineKeyboardMarkup,
} from './telegram';
import { CONS, DEFAULT_CON, getCon } from '../data/cons';

/**
 * Crew — one Durable Object per group chat. For this de-risk slice it owns just
 * enough to prove the bot loop: which chat to post to, whether we're an admin,
 * the id of the pinned digest message, and a dedupe ledger.
 *
 * The digest is delivered by a self-scheduling 5-minute alarm. Two gotchas the
 * design turns on:
 *  1. Alarms are one-shot and at-least-once (up to 6 retries). We re-arm at the
 *     START of alarm() so a mid-handler throw still leaves a future alarm, and a
 *     retried alarm must not double-post.
 *  2. Idempotency is a SQL PRIMARY KEY. The first post for a 5-minute bucket
 *     claims the bucket via `INSERT OR IGNORE`; a retry in the same bucket writes
 *     0 rows and bails, so it never sends a second pinned message. Once a pinned
 *     message exists, every later tick just edits it (edits fire no
 *     notification), which is safe to repeat.
 */

/**
 * A roster plan is one starred occurrence, resolved against the con's schedule.
 * `title`/`start`/`room` are present when the id is known; an unknown id (stale
 * or client-fabricated) degrades to just `{ occurrenceId }` rather than throwing.
 */
export interface RosterPlan {
  occurrenceId: string;
  title?: string;
  start?: string;
  room?: string | null;
}

/** One crew member's public roster view. For a ghost member `plans` is `[]`. */
export interface RosterEntry {
  userId: number;
  displayName: string;
  ghost: boolean;
  plans: RosterPlan[];
}

/** The subset of a con occurrence the roster resolves a star id against. */
interface OccurrenceLookup {
  id: string;
  title: string;
  start: string;
  room: string | null;
}

/** The raw occurrence shape in a con's schedule JSON (only the fields we read). */
interface RawOccurrence {
  id: string;
  title: string;
  room: string | null;
  start: string;
  end: string;
}

/** A parsed, con-specific schedule: the digest list + the id→occurrence lookup. */
interface LoadedSchedule {
  list: DigestOccurrence[];
  byId: Map<string, OccurrenceLookup>;
}

/**
 * How long a loaded per-con schedule stays cached in the DO before the next read
 * re-fetches from KV/asset. The alarm fires every 5 min, so a value just under
 * that means a live KV edit surfaces within one digest cycle while a burst of
 * calls in the same tick reuses the parse.
 */
const SCHEDULE_CACHE_TTL_MS = 4 * 60 * 1000;

/**
 * Thrown by loadSchedule when NEITHER KV nor the asset yields a valid schedule for
 * a con. Distinct from an empty-but-valid schedule: this means "we could not load
 * anything", so postDigest skips (keeping the last good pin) and getRoster degrades
 * rather than either silently posting an empty "Nothing scheduled" digest.
 */
class ScheduleLoadError extends Error {
  constructor(conId: string) {
    super(`schedule load failed for con=${conId} (no valid KV value or asset)`);
    this.name = 'ScheduleLoadError';
  }
}

interface CrewMemberRow {
  [column: string]: number | string | null;
  user_id: number;
  display_name: string | null;
  ghost: number;
}

interface MemberStarRow {
  [column: string]: number | string | null;
  occurrence_id: string;
}

/**
 * A custom (unofficial) event — a room party, dinner, anything the official
 * schedule never carries. It is a STANDALONE record keyed by `eventId`, NOT
 * nested inside a member: that is what makes "leave the crew" (pure privacy)
 * different from "cancel this event" (owner-only). Leaving must never destroy an
 * event other members starred.
 *
 * `location` is FREE-TEXT ONLY (e.g. "Rm 1412"). There is deliberately NO map,
 * pin, coordinate, lat/lng, or live-location field — a hard product constraint.
 */
export interface CustomEvent {
  eventId: string;
  ownerId: number;
  title: string;
  day: string | null;
  startIso: string | null;
  endIso: string | null;
  /** Plain free-text location string only — never coordinates/map data. */
  location: string | null;
  notes: string | null;
  cancelled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * A custom event as seen by a viewer via listEvents. Adds the derived star count
 * and, when a viewerId is supplied, whether the viewer starred it / owns it.
 * Cancelled events are still returned (with `cancelled: true`) so the UI can
 * render "[CANCELLED]" rather than have the event silently vanish.
 */
export interface CustomEventView extends CustomEvent {
  starCount: number;
  viewerStarred?: boolean;
  isOwner?: boolean;
}

/** Mutable fields accepted by createEvent/editEvent. `location` is free text. */
export interface CustomEventInput {
  title?: string;
  day?: string | null;
  startIso?: string | null;
  endIso?: string | null;
  location?: string | null;
  notes?: string | null;
}

interface CustomEventRow {
  [column: string]: number | string | null;
  event_id: string;
  owner_id: number;
  title: string;
  day: string | null;
  start_iso: string | null;
  end_iso: string | null;
  location: string | null;
  notes: string | null;
  cancelled: number;
  created_at: number;
  updated_at: number;
}

interface CountRow {
  [column: string]: number;
  n: number;
}

/** Upper bound on a stored free-text field, so a hostile client can't blow up storage. */
const MAX_TEXT = 2000;

/**
 * Normalize an optional free-text field: non-strings and blank strings become
 * NULL; anything else is trimmed and length-capped. Used for day/start/end/
 * location/notes — none of which are ever coordinates.
 */
function normText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed.slice(0, MAX_TEXT);
}

const DIGEST_INTERVAL_MS = 5 * 60 * 1000;

/** Defensive cap on stored stars per member — a hostile client can't blow up storage. */
const MAX_STARS = 1000;

interface CrewConfigRow {
  // Index signature so the row type satisfies sql.exec<T>'s Record constraint.
  [column: string]: number | string | null;
  chat_id: number | null;
  pinned_message_id: number | null;
  is_admin: number;
  con_id: string;
}

/** PRAGMA table_info row shape (only the column name is read). */
interface TableInfoRow {
  [column: string]: number | string | null;
  name: string;
}

export class Crew extends DurableObject<Env> {
  /**
   * Per-instance cache of the con's parsed schedule. Keyed by con id so a con
   * change (setCon) forces a reload; TTL-refreshed so a live KV edit surfaces
   * within one alarm cycle. `null` until the first loadSchedule.
   */
  private scheduleCache: { conId: string; loadedAt: number; data: LoadedSchedule } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Schema setup is synchronous SQL, so it runs directly in the constructor —
    // no blockConcurrencyWhile needed (that's for async init).
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS crew_config (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         chat_id INTEGER,
         pinned_message_id INTEGER,
         is_admin INTEGER NOT NULL DEFAULT 0
       )`,
    );
    // Multi-con migration: give each crew a con_id. ALTER TABLE has no
    // IF NOT EXISTS, so guard with a PRAGMA check — a pre-Tic-5 DB (the column
    // absent) gets it added with DEFAULT 'fureh', which BACKFILLS the existing
    // live-crew row to 'fureh' (NOT NULL DEFAULT applies to existing rows).
    this.ensureConColumn();
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS digest_posts (
         dedupe_key TEXT PRIMARY KEY,
         posted_at INTEGER NOT NULL
       )`,
    );
    // Crew roster: one row per member who has opted in via /api/sync. `ghost` is
    // the load-bearing privacy flag — when 1, getRoster redacts this member's
    // plans SERVER-SIDE (their stars are still stored below, just never emitted).
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS crew_member (
         user_id INTEGER PRIMARY KEY,
         display_name TEXT,
         ghost INTEGER NOT NULL DEFAULT 0,
         updated_at INTEGER NOT NULL
       )`,
    );
    // A member's starred occurrences. The composite PK is per-member, so two
    // members starring the SAME occurrence never collide.
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS member_star (
         user_id INTEGER NOT NULL,
         occurrence_id TEXT NOT NULL,
         PRIMARY KEY(user_id, occurrence_id)
       )`,
    );
    // Custom (unofficial) events: standalone records keyed by event_id, owned by
    // whoever created them. `cancelled` is a SOFT flag (never DELETE) so a
    // cancelled room party still renders "[CANCELLED]" to everyone who starred it.
    // `location` is free text ONLY — there is intentionally no coordinate column.
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS custom_event (
         event_id TEXT PRIMARY KEY,
         owner_id INTEGER NOT NULL,
         title TEXT NOT NULL,
         day TEXT,
         start_iso TEXT,
         end_iso TEXT,
         location TEXT,
         notes TEXT,
         cancelled INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    );
    // Anyone may star ANY custom event; composite PK keeps stars idempotent and
    // per-user. Leaving the crew clears the leaver's rows here but NOT the events
    // they own (other people's stars survive).
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS custom_event_star (
         event_id TEXT NOT NULL,
         user_id INTEGER NOT NULL,
         PRIMARY KEY(event_id, user_id)
       )`,
    );
  }

  /**
   * Idempotently add the crew_config.con_id column when it is missing. Split out
   * of the constructor so it is exercisable in isolation (a test can drop to the
   * pre-Tic-5 schema and re-run just this guard).
   */
  private ensureConColumn(): void {
    const cols = this.ctx.storage.sql
      .exec<TableInfoRow>('PRAGMA table_info(crew_config)')
      .toArray();
    if (!cols.some((c) => c.name === 'con_id')) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE crew_config ADD COLUMN con_id TEXT NOT NULL DEFAULT 'fureh'",
      );
    }
  }

  /**
   * Load the given con's schedule (KV-first, asset fallback — the same sharp edge
   * as GET /api/schedule), parsed into the digest list + id→occurrence lookup.
   *
   * KV WINS so a live edit overrides the baked asset with no redeploy — BUT a KV
   * value that fails to parse is treated as a MISS and we fall through to the
   * asset, so a corrupt live override never shadows a valid baked file. On the
   * asset path, the single-page-application binding resolves a MISSING file to
   * index.html at HTTP 200, so we guard on a JSON content-type.
   *
   * THROWS `ScheduleLoadError` when BOTH KV and asset yield nothing valid — a
   * genuinely-empty-but-valid schedule (`{occurrences:[]}`) is NOT a failure and
   * returns an empty result. Callers decide how to handle the throw: postDigest
   * skips (preserving the last good pin), getRoster degrades to un-enriched plans.
   *
   * Only a SUCCESSFUL load is cached (per con id, short TTL): repeated calls in one
   * alarm tick reuse the parse, a con change reloads immediately, and a live KV
   * edit surfaces within a cycle. `this.env` (SCHEDULES + ASSETS) comes from the
   * DurableObject base.
   */
  private async loadSchedule(conId: string): Promise<LoadedSchedule> {
    const cached = this.scheduleCache;
    if (
      cached !== null &&
      cached.conId === conId &&
      Date.now() - cached.loadedAt < SCHEDULE_CACHE_TTL_MS
    ) {
      return cached.data;
    }

    const data = await this.fetchSchedule(conId);
    if (data === null) throw new ScheduleLoadError(conId);
    this.scheduleCache = { conId, loadedAt: Date.now(), data };
    return data;
  }

  /**
   * KV-first, asset-fallback resolution of a con's parsed schedule, or `null` when
   * NOTHING valid is available. A KV value that is present but unparseable is
   * logged and treated as a miss (fall through to the asset).
   */
  private async fetchSchedule(conId: string): Promise<LoadedSchedule | null> {
    const fromKv = await this.env.SCHEDULES.get(conId);
    if (fromKv !== null) {
      const parsed = Crew.parseSchedule(fromKv);
      if (parsed !== null) return parsed;
      // Corrupt live override: do NOT let it shadow a valid asset — fall through.
      console.warn(`crew: KV schedule for con=${conId} is unparseable — falling back to asset`);
    }

    const assetRes = await this.env.ASSETS.fetch(
      new URL(`/data/${conId}.json`, 'https://assets.local'),
    );
    const contentType = assetRes.headers.get('content-type') ?? '';
    if (!assetRes.ok || !contentType.includes('json')) return null;
    return Crew.parseSchedule(await assetRes.text());
  }

  /**
   * Parse raw schedule JSON into the digest list + id lookup. Returns `null` for
   * ANY malformed input — unparseable text, a non-object top level (including a
   * literal JSON `null`), a missing/non-array `occurrences`, OR an array in which
   * ANY entry is not an object carrying a string `id` and string `start` (the
   * fields the DO actually reads). Rejecting the WHOLE payload on a single garbage
   * entry is deliberate: a corrupt KV override must fall through to the valid
   * asset, never shadow it with junk. A legitimately EMPTY-but-valid schedule
   * (`{occurrences:[]}`) is NOT malformed → returns an empty, non-null result.
   * The entire body is wrapped in try/catch so a hostile shape can never throw
   * past the malformed-KV fallthrough.
   */
  private static parseSchedule(raw: string): LoadedSchedule | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') return null;
      const occ = (parsed as { occurrences?: unknown }).occurrences;
      if (!Array.isArray(occ)) return null;

      const list: DigestOccurrence[] = [];
      const byId = new Map<string, OccurrenceLookup>();
      for (const item of occ) {
        if (item === null || typeof item !== 'object') return null;
        const o = item as Partial<RawOccurrence>;
        // Hard requirement: the identity + time fields the DO reads must be strings.
        if (typeof o.id !== 'string' || typeof o.start !== 'string') return null;
        // Display fields are soft: default rather than reject, so a real feed that
        // omits an optional title/room/end still loads well-formed.
        const title = typeof o.title === 'string' ? o.title : '';
        const end = typeof o.end === 'string' ? o.end : o.start;
        const room = typeof o.room === 'string' ? o.room : null;
        list.push({ title, room, start: o.start, end });
        byId.set(o.id, { id: o.id, title, start: o.start, room });
      }
      return { list, byId };
    } catch {
      return null;
    }
  }

  /**
   * Attach this crew to a Telegram chat and arm the first digest alarm. When
   * `conId` is a known con it is persisted; an unknown/absent con leaves the
   * existing con_id untouched (a live crew keeps serving its con).
   */
  async configure(chatId: number, conId?: string): Promise<void> {
    const prev = this.config();
    this.ctx.storage.sql.exec(
      `INSERT INTO crew_config (id, chat_id, is_admin) VALUES (1, ?, 0)
       ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id`,
      chatId,
    );
    if (conId !== undefined && getCon(conId) !== null) {
      this.ctx.storage.sql.exec('UPDATE crew_config SET con_id = ? WHERE id = 1', conId);
    }
    // Rebinding to a different chat invalidates the old pinned message id AND the
    // dedupe ledger (else a same-bucket claim would suppress the new chat's first
    // post).
    if (prev?.chat_id != null && prev.chat_id !== chatId) {
      this.ctx.storage.sql.exec('UPDATE crew_config SET pinned_message_id = NULL WHERE id = 1');
      this.ctx.storage.sql.exec('DELETE FROM digest_posts');
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + DIGEST_INTERVAL_MS);
    }
  }

  /**
   * The bot was removed from the chat (left / kicked): cancel the alarm and
   * forget the chat, so it doesn't keep firing failing Telegram calls forever.
   */
  async deactivate(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    this.ctx.storage.sql.exec(
      'UPDATE crew_config SET chat_id = NULL, pinned_message_id = NULL, is_admin = 0 WHERE id = 1',
    );
    // Forget the dedupe ledger too, so a re-add in the same 5-min bucket isn't
    // suppressed by a stale claim.
    this.ctx.storage.sql.exec('DELETE FROM digest_posts');
  }

  /** Record whether the bot is a group admin (drives pin vs plain send). */
  setAdmin(isAdmin: boolean): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO crew_config (id, is_admin) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin`,
      isAdmin ? 1 : 0,
    );
  }

  /**
   * Switch which con this crew serves. Validates via getCon and REJECTS an unknown
   * id (returns false, leaving con_id unchanged) so a typo can't strand a crew on a
   * con with no data. On success the next digest/roster reflects the new con — the
   * schedule cache is keyed by con id, so it reloads on the very next read.
   */
  setCon(conId: string): boolean {
    if (getCon(conId) === null) return false;
    this.ctx.storage.sql.exec(
      `INSERT INTO crew_config (id, con_id) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET con_id = excluded.con_id`,
      conId,
    );
    return true;
  }

  /** The con id this crew serves (defaults to Fureh if somehow unset). */
  con(): string {
    return this.config()?.con_id ?? DEFAULT_CON;
  }

  override async alarm(): Promise<void> {
    // If the crew was deactivated (bot removed), stop — do NOT re-arm, or a
    // queued/racing alarm would resurrect an orphan that wakes forever.
    if (this.config()?.chat_id == null) return;
    // Re-arm before posting so a throw in postDigest still leaves a future alarm
    // (setAlarm overwrites, so exactly one is ever pending).
    await this.ctx.storage.setAlarm(Date.now() + DIGEST_INTERVAL_MS);
    await this.postDigest(Date.now());
  }

  /**
   * Build and deliver the digest for the 5-minute bucket containing `nowMs`.
   * Safe to call more than once for the same bucket (see the class comment).
   */
  async postDigest(nowMs: number): Promise<void> {
    const cfg = this.config();
    if (cfg?.chat_id == null) return; // not attached to a chat yet
    const token = this.env.BOT_TOKEN;
    // Serve THIS crew's con: load its schedule (KV→asset) and render times in the
    // con's own timezone. This is what removed the last baked schedule import.
    const con = getCon(cfg.con_id) ?? CONS[DEFAULT_CON];

    // Load failure must NOT clobber the last good pinned digest with an empty
    // "Nothing scheduled" one — skip this post entirely and let the (already
    // re-armed) alarm retry next cycle.
    let sched: LoadedSchedule;
    try {
      sched = await this.loadSchedule(con.id);
    } catch (err) {
      console.warn('digest skipped:', err instanceof Error ? err.message : err);
      return;
    }

    // Post-load stale-con guard: loadSchedule awaited, and a concurrent setCon may
    // have changed the con in the meantime. If it changed, abort — the setCon path
    // / next alarm will post the correct con rather than editing the pin back to
    // this now-stale con's data.
    if (this.con() !== con.id) return;

    const text = buildDigest(sched.list, new Date(nowMs), con.tz);

    const markup = this.launchMarkup(cfg.chat_id, con.id);

    // Re-read the con IMMEDIATELY BEFORE each outbound Telegram call (edit/send AND
    // the pin): a setCon can interleave during any awaited call above, so a single
    // early guard is not enough. The ONLY residual window is the con changing
    // DURING the send()/edit() HTTP round-trip itself — accepted, because the next
    // 5-minute alarm re-posts in the correct con and self-heals it.

    // Steady state: a pinned message exists → quiet edit in place, no dedupe
    // needed because edits fire no notification and are idempotent to repeat.
    if (cfg.pinned_message_id !== null) {
      if (this.con() !== con.id) return;
      await editMessageText(token, cfg.chat_id, cfg.pinned_message_id, text, markup);
      // Retry the pin every tick: if the initial pin failed (missing rights) it
      // self-heals the moment the admin right is granted; re-pinning an already
      // pinned message is a harmless no-op.
      if (this.con() !== con.id) return;
      await this.tryPin(token, cfg.chat_id, cfg.pinned_message_id, cfg.is_admin);
      return;
    }

    // First post for this crew: atomically claim the bucket. INSERT OR IGNORE
    // writes 0 rows if a retried invocation already claimed it → bail, so an
    // at-least-once alarm retry never sends a second pinned message.
    const bucket = Math.floor(nowMs / DIGEST_INTERVAL_MS).toString();
    const claim = this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO digest_posts (dedupe_key, posted_at) VALUES (?, ?)',
      bucket,
      nowMs,
    );
    if (claim.rowsWritten === 0) return;

    if (this.con() !== con.id) return;
    const messageId = await sendMessage(token, cfg.chat_id, text, markup);
    // Persist the message id BEFORE pinning: if the pin call throws, a retry
    // finds a pinned_message_id and edits instead of sending a duplicate.
    this.ctx.storage.sql.exec(
      'UPDATE crew_config SET pinned_message_id = ? WHERE id = 1',
      messageId,
    );
    if (this.con() !== con.id) return;
    await this.tryPin(token, cfg.chat_id, messageId, cfg.is_admin);
  }

  /**
   * Pin the digest, silently. Non-fatal: a missing "Pin Messages" right must not
   * break the digest itself (the post already succeeded), and pinning is retried
   * on later ticks so it heals once the right is granted.
   */
  private async tryPin(
    token: string,
    chatId: number,
    messageId: number,
    isAdmin: number,
  ): Promise<void> {
    if (isAdmin !== 1) return;
    try {
      await pinChatMessage(token, chatId, messageId);
    } catch (err) {
      console.warn('pin skipped:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * The inline-keyboard "launch the Mini App" button for the pinned digest, or
   * undefined when no Mini App url is configured (→ the digest posts with no
   * button, byte-identical to before). The button is a Direct Link Mini App:
   * `${MINIAPP_URL}?startapp=<conId>__<chat_id>` carries BOTH the crew's con (a
   * display-only hint) and its own chat id (the membership-verified selector), so
   * the client opens straight into the right con. The chat id is everything after
   * the first `__`; a negative supergroup id is a valid startapp value.
   *
   * Pinned buttons are rebuilt every digest and the message is edited in place, so
   * a pre-Tic-5 bare `?startapp=<chatId>` button upgrades to the con-tagged form on
   * the next alarm with no migration.
   */
  private launchMarkup(chatId: number, conId: string): InlineKeyboardMarkup | undefined {
    const base = this.env.MINIAPP_URL;
    if (typeof base !== 'string' || base === '') return undefined;
    return {
      inline_keyboard: [
        [
          {
            text: '🗓 Open the crew schedule',
            url: `${base}?startapp=${conId}__${String(chatId)}`,
          },
        ],
      ],
    };
  }

  // ── Crew roster (member plans + ghost mode) ────────────────────────────────

  /**
   * Upsert a member and REPLACE their star set atomically. All synchronous SQL,
   * so it runs in one implicit transaction — a member never observes their old
   * stars deleted but the new ones not yet inserted.
   *
   * `ghost` is stored verbatim; its redaction effect lives in getRoster (defense
   * in depth: even a stored ghost member's plans are never emitted). Stars ARE
   * still stored for a ghost member, so flipping ghost off later reveals them.
   */
  syncMember(userId: number, displayName: string, ghost: boolean, starIds: string[]): void {
    // Reject a non-finite id defensively — it would poison the PRIMARY KEY.
    if (!Number.isFinite(userId)) return;
    // Atomicity: the member upsert + star DELETE + re-INSERT loop must commit as a
    // UNIT. Wrapped in transactionSync so a mid-insert failure rolls the whole
    // section back — no member is ever left with an empty/partial star set.
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO crew_member (user_id, display_name, ghost, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           display_name = excluded.display_name,
           ghost = excluded.ghost,
           updated_at = excluded.updated_at`,
        userId,
        displayName,
        ghost ? 1 : 0,
        Date.now(),
      );
      // Replace the star set: clear the member's rows, then insert the new ones.
      this.ctx.storage.sql.exec('DELETE FROM member_star WHERE user_id = ?', userId);
      const seen = new Set<string>();
      for (const raw of starIds) {
        if (typeof raw !== 'string' || raw === '' || raw.length > 200) continue;
        if (seen.has(raw)) continue; // de-dupe so a repeated id isn't a wasted insert
        seen.add(raw);
        if (seen.size > MAX_STARS) break;
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO member_star (user_id, occurrence_id) VALUES (?, ?)',
          userId,
          raw,
        );
      }
    });
  }

  /**
   * The crew roster — one entry per member. A ghost member STILL appears (so the
   * crew knows they're aboard) but their `plans` is redacted to `[]` here, on the
   * server, before anything hits the wire. A non-ghost member's stars are
   * resolved against the con's schedule (unknown ids degrade to `{ occurrenceId }`).
   */
  async getRoster(): Promise<RosterEntry[]> {
    // Resolve star ids against THIS crew's con schedule (KV→asset), not a baked map.
    // On a load failure, DEGRADE gracefully: an empty lookup means plans carry only
    // their occurrenceId (no title/start/room enrichment) — the roster API still
    // works rather than 500ing when a schedule is momentarily unavailable.
    let byId: Map<string, OccurrenceLookup>;
    try {
      byId = (await this.loadSchedule(this.con())).byId;
    } catch (err) {
      console.warn('roster: schedule enrichment unavailable:', err instanceof Error ? err.message : err);
      byId = new Map();
    }
    const members = this.ctx.storage.sql
      .exec<CrewMemberRow>('SELECT user_id, display_name, ghost FROM crew_member')
      .toArray();

    const roster: RosterEntry[] = members.map((m) => {
      const ghost = m.ghost === 1;
      const displayName = m.display_name ?? '';
      // GHOST REDACTION: never read — let alone emit — a ghost member's stars.
      if (ghost) {
        return { userId: m.user_id, displayName, ghost, plans: [] };
      }
      const stars = this.ctx.storage.sql
        .exec<MemberStarRow>('SELECT occurrence_id FROM member_star WHERE user_id = ?', m.user_id)
        .toArray();
      const plans: RosterPlan[] = stars.map((s) => {
        const occ = byId.get(s.occurrence_id);
        return occ === undefined
          ? { occurrenceId: s.occurrence_id }
          : {
              occurrenceId: s.occurrence_id,
              title: occ.title,
              start: occ.start,
              room: occ.room,
            };
      });
      // Plans by start (unknown/undated sort last, then by id for stability).
      plans.sort((a, b) => {
        if (a.start !== undefined && b.start !== undefined) {
          if (a.start !== b.start) return a.start < b.start ? -1 : 1;
        } else if (a.start === undefined && b.start !== undefined) {
          return 1;
        } else if (a.start !== undefined && b.start === undefined) {
          return -1;
        }
        return a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0;
      });
      return { userId: m.user_id, displayName, ghost, plans };
    });

    // Members by displayName then userId — a deterministic order for the client.
    roster.sort((a, b) => {
      if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
      return a.userId - b.userId;
    });
    return roster;
  }

  /**
   * Remove a member entirely: their roster row, their occurrence stars, and their
   * stars on custom events (pure privacy). Touches ONLY this member's own rows.
   *
   * leave != cancel. By DEFAULT leaving does NOT touch custom_event rows the member
   * OWNS — a room party other people starred must survive the owner leaving. ONLY
   * when `opts.cancelOwnEvents === true` does leaving additionally SOFT-cancel the
   * events they own (set cancelled=1, still visible as "[CANCELLED]"). That flag is
   * OFF by default. The whole thing runs in one transaction.
   */
  leaveCrew(userId: number, opts?: { cancelOwnEvents?: boolean }): void {
    if (!Number.isFinite(userId)) return;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM member_star WHERE user_id = ?', userId);
      this.ctx.storage.sql.exec('DELETE FROM crew_member WHERE user_id = ?', userId);
      // Drop the leaver's OWN stars only — never other members' stars, and never
      // the events the leaver owns (those belong to everyone who starred them).
      this.ctx.storage.sql.exec('DELETE FROM custom_event_star WHERE user_id = ?', userId);
      if (opts?.cancelOwnEvents === true) {
        this.ctx.storage.sql.exec(
          'UPDATE custom_event SET cancelled = 1, updated_at = ? WHERE owner_id = ? AND cancelled = 0',
          Date.now(),
          userId,
        );
      }
    });
  }

  // ── Custom events (unofficial room parties, dinners, …) ────────────────────

  /** Fetch a single custom event row, or null if the id is unknown. */
  private eventRow(eventId: string): CustomEventRow | null {
    if (typeof eventId !== 'string' || eventId === '') return null;
    const rows = this.ctx.storage.sql
      .exec<CustomEventRow>('SELECT * FROM custom_event WHERE event_id = ?', eventId)
      .toArray();
    return rows[0] ?? null;
  }

  private static rowToEvent(row: CustomEventRow): CustomEvent {
    return {
      eventId: row.event_id,
      ownerId: row.owner_id,
      title: row.title,
      day: row.day,
      startIso: row.start_iso,
      endIso: row.end_iso,
      location: row.location,
      notes: row.notes,
      cancelled: row.cancelled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create a custom event owned by `ownerId`. `title` is required (non-empty after
   * trim) — throws otherwise. All other fields are optional free text. Returns the
   * created event.
   */
  createEvent(ownerId: number, input: CustomEventInput): CustomEvent {
    if (!Number.isFinite(ownerId)) throw new Error('invalid ownerId');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title === '') throw new Error('title required');
    const now = Date.now();
    const eventId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO custom_event
         (event_id, owner_id, title, day, start_iso, end_iso, location, notes, cancelled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      eventId,
      ownerId,
      title.slice(0, MAX_TEXT),
      normText(input.day),
      normText(input.startIso),
      normText(input.endIso),
      normText(input.location),
      normText(input.notes),
      now,
      now,
    );
    const row = this.eventRow(eventId);
    if (row === null) throw new Error('createEvent failed');
    return Crew.rowToEvent(row);
  }

  /**
   * Edit a custom event. OWNER-ONLY: throws if the caller is not the owner (the
   * row is left untouched). Editing a cancelled event is refused — keep it simple,
   * a cancel is terminal. Only fields present in `input` change; a present value of
   * null clears that field. Returns the updated event.
   */
  editEvent(ownerId: number, eventId: string, input: CustomEventInput): CustomEvent {
    const row = this.eventRow(eventId);
    if (row === null) throw new Error('event not found');
    if (row.owner_id !== ownerId) throw new Error('not owner');
    if (row.cancelled === 1) throw new Error('cannot edit a cancelled event');

    // Title: if supplied it must remain non-empty; if omitted keep the existing one.
    const title =
      input.title === undefined
        ? row.title
        : typeof input.title === 'string'
          ? input.title.trim()
          : '';
    if (title === '') throw new Error('title required');
    // For the rest: undefined = keep existing; a present value = set (null clears).
    const day = input.day === undefined ? row.day : normText(input.day);
    const startIso = input.startIso === undefined ? row.start_iso : normText(input.startIso);
    const endIso = input.endIso === undefined ? row.end_iso : normText(input.endIso);
    const location = input.location === undefined ? row.location : normText(input.location);
    const notes = input.notes === undefined ? row.notes : normText(input.notes);

    this.ctx.storage.sql.exec(
      `UPDATE custom_event
         SET title = ?, day = ?, start_iso = ?, end_iso = ?, location = ?, notes = ?, updated_at = ?
       WHERE event_id = ?`,
      title.slice(0, MAX_TEXT),
      day,
      startIso,
      endIso,
      location,
      notes,
      Date.now(),
      eventId,
    );
    const updated = this.eventRow(eventId);
    if (updated === null) throw new Error('editEvent failed');
    return Crew.rowToEvent(updated);
  }

  /**
   * SOFT-cancel a custom event. OWNER-ONLY (throws otherwise). Sets cancelled=1 —
   * the row is NEVER deleted, so starrers keep seeing it as "[CANCELLED]".
   * Idempotent: cancelling an already-cancelled event is a harmless no-op.
   */
  cancelEvent(ownerId: number, eventId: string): void {
    const row = this.eventRow(eventId);
    if (row === null) throw new Error('event not found');
    if (row.owner_id !== ownerId) throw new Error('not owner');
    this.ctx.storage.sql.exec(
      'UPDATE custom_event SET cancelled = 1, updated_at = ? WHERE event_id = ?',
      Date.now(),
      eventId,
    );
  }

  /**
   * Star a custom event. ANYONE may star ANY event (INSERT OR IGNORE, so repeat
   * stars are no-ops). Throws only if the event id is unknown.
   */
  starEvent(userId: number, eventId: string): void {
    if (!Number.isFinite(userId)) throw new Error('invalid userId');
    if (this.eventRow(eventId) === null) throw new Error('event not found');
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO custom_event_star (event_id, user_id) VALUES (?, ?)',
      eventId,
      userId,
    );
  }

  /** Remove the caller's star from an event. Idempotent; no error if not starred. */
  unstarEvent(userId: number, eventId: string): void {
    if (!Number.isFinite(userId)) return;
    this.ctx.storage.sql.exec(
      'DELETE FROM custom_event_star WHERE event_id = ? AND user_id = ?',
      eventId,
      userId,
    );
  }

  /**
   * List ALL custom events (including cancelled — the UI renders "[CANCELLED]"
   * rather than hiding them). Each carries a live `starCount`; when a viewerId is
   * given, also `viewerStarred` and `isOwner`. Sorted by start_iso (undated last)
   * then title.
   */
  listEvents(viewerId?: number): CustomEventView[] {
    const rows = this.ctx.storage.sql
      .exec<CustomEventRow>('SELECT * FROM custom_event')
      .toArray();
    const views: CustomEventView[] = rows.map((row) => {
      const countRows = this.ctx.storage.sql
        .exec<CountRow>('SELECT COUNT(*) AS n FROM custom_event_star WHERE event_id = ?', row.event_id)
        .toArray();
      const view: CustomEventView = {
        ...Crew.rowToEvent(row),
        starCount: countRows[0]?.n ?? 0,
      };
      if (viewerId !== undefined) {
        const starred = this.ctx.storage.sql
          .exec('SELECT 1 FROM custom_event_star WHERE event_id = ? AND user_id = ?', row.event_id, viewerId)
          .toArray();
        view.viewerStarred = starred.length > 0;
        view.isOwner = row.owner_id === viewerId;
      }
      return view;
    });
    // Sort by start_iso (undated sorts last), then title, then eventId for stability.
    views.sort((a, b) => {
      if (a.startIso !== null && b.startIso !== null) {
        if (a.startIso !== b.startIso) return a.startIso < b.startIso ? -1 : 1;
      } else if (a.startIso === null && b.startIso !== null) {
        return 1;
      } else if (a.startIso !== null && b.startIso === null) {
        return -1;
      }
      if (a.title !== b.title) return a.title < b.title ? -1 : 1;
      return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
    });
    return views;
  }

  private config(): CrewConfigRow | null {
    const rows = this.ctx.storage.sql
      .exec<CrewConfigRow>(
        'SELECT chat_id, pinned_message_id, is_admin, con_id FROM crew_config WHERE id = 1',
      )
      .toArray();
    return rows[0] ?? null;
  }
}
