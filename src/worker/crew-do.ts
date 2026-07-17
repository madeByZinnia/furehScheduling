import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { buildDigest, type DigestOccurrence } from './digest';
import { editMessageText, pinChatMessage, sendMessage } from './telegram';
import scheduleData from '../data/schedule.json';

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

/** Baked schedule occurrences the digest reads from (the SPA's expanded data). */
const OCCURRENCES = scheduleData.occurrences as DigestOccurrence[];

/**
 * A roster plan is one starred occurrence, resolved against the baked schedule.
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

/** The subset of a baked occurrence the roster resolves a star id against. */
interface OccurrenceLookup {
  id: string;
  title: string;
  start: string;
  room: string | null;
}

/** id → occurrence, so getRoster can enrich a star id in O(1) with no scan. */
const OCCURRENCE_BY_ID = new Map<string, OccurrenceLookup>();
for (const o of scheduleData.occurrences as OccurrenceLookup[]) {
  OCCURRENCE_BY_ID.set(o.id, o);
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

const DIGEST_INTERVAL_MS = 5 * 60 * 1000;

/** Defensive cap on stored stars per member — a hostile client can't blow up storage. */
const MAX_STARS = 1000;

interface CrewConfigRow {
  // Index signature so the row type satisfies sql.exec<T>'s Record constraint.
  [column: string]: number | null;
  chat_id: number | null;
  pinned_message_id: number | null;
  is_admin: number;
}

export class Crew extends DurableObject<Env> {
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
  }

  /** Attach this crew to a Telegram chat and arm the first digest alarm. */
  async configure(chatId: number): Promise<void> {
    const prev = this.config();
    this.ctx.storage.sql.exec(
      `INSERT INTO crew_config (id, chat_id, is_admin) VALUES (1, ?, 0)
       ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id`,
      chatId,
    );
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
    const text = buildDigest(OCCURRENCES, new Date(nowMs));

    // Steady state: a pinned message exists → quiet edit in place, no dedupe
    // needed because edits fire no notification and are idempotent to repeat.
    if (cfg.pinned_message_id !== null) {
      await editMessageText(token, cfg.chat_id, cfg.pinned_message_id, text);
      // Retry the pin every tick: if the initial pin failed (missing rights) it
      // self-heals the moment the admin right is granted; re-pinning an already
      // pinned message is a harmless no-op.
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

    const messageId = await sendMessage(token, cfg.chat_id, text);
    // Persist the message id BEFORE pinning: if the pin call throws, a retry
    // finds a pinned_message_id and edits instead of sending a duplicate.
    this.ctx.storage.sql.exec(
      'UPDATE crew_config SET pinned_message_id = ? WHERE id = 1',
      messageId,
    );
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
   * resolved against the baked schedule (unknown ids degrade to `{ occurrenceId }`).
   */
  getRoster(): RosterEntry[] {
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
        const occ = OCCURRENCE_BY_ID.get(s.occurrence_id);
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
   * Remove a member entirely: their roster row AND their stars (pure privacy).
   * Touches ONLY this member — no other member's data is affected.
   *
   * NOTE: leave != cancel. Cancelling any custom event this member created is a
   * SEPARATE future concern and is deliberately NOT done here.
   */
  leaveCrew(userId: number): void {
    if (!Number.isFinite(userId)) return;
    this.ctx.storage.sql.exec('DELETE FROM member_star WHERE user_id = ?', userId);
    this.ctx.storage.sql.exec('DELETE FROM crew_member WHERE user_id = ?', userId);
  }

  private config(): CrewConfigRow | null {
    const rows = this.ctx.storage.sql
      .exec<CrewConfigRow>(
        'SELECT chat_id, pinned_message_id, is_admin FROM crew_config WHERE id = 1',
      )
      .toArray();
    return rows[0] ?? null;
  }
}
