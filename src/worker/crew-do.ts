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

const DIGEST_INTERVAL_MS = 5 * 60 * 1000;

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
  }

  /** Attach this crew to a Telegram chat and arm the first digest alarm. */
  async configure(chatId: number): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO crew_config (id, chat_id, is_admin) VALUES (1, ?, 0)
       ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id`,
      chatId,
    );
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + DIGEST_INTERVAL_MS);
    }
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
    // Re-arm FIRST — alarms don't repeat; setAlarm overwrites so exactly one is
    // ever pending. Doing this before the post means a failed post still leaves
    // a future alarm scheduled.
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

  private config(): CrewConfigRow | null {
    const rows = this.ctx.storage.sql
      .exec<CrewConfigRow>(
        'SELECT chat_id, pinned_message_id, is_admin FROM crew_config WHERE id = 1',
      )
      .toArray();
    return rows[0] ?? null;
  }
}
