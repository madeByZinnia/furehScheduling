import type { Crew } from './crew-do';

/**
 * Runtime bindings for the Worker (declared in wrangler.jsonc). Kept in its own
 * module so both the entry (index.ts) and the Durable Object (crew-do.ts) can
 * import it without a value-level cycle — the `Crew` reference is type-only.
 */
export interface Env {
  /** One Durable Object per crew (idFromName(crewId)); holds crew state + alarm. */
  CREW: DurableObjectNamespace<Crew>;
  /**
   * BotFather token — a secret, never committed. Also the HMAC key material for
   * verifying Telegram initData (secret = HMAC(BOT_TOKEN, "WebAppData")).
   */
  BOT_TOKEN: string;
  /**
   * Shared secret Telegram echoes back in the `X-Telegram-Bot-Api-Secret-Token`
   * header on webhook calls (set at setWebhook time). Optional so local/dev runs
   * without it still function.
   */
  WEBHOOK_SECRET?: string;
  /**
   * Bearer key guarding the one-shot /telegram/setup endpoint (discovers the
   * crew chat + registers the webhook, all server-side). Optional; when unset the
   * endpoint is open (fine for local, set it in production).
   */
  SETUP_KEY?: string;
  /**
   * Direct Link Mini App base URL (e.g. https://t.me/mybot/app). When set, the
   * pinned digest carries an inline "open the crew schedule" button whose url is
   * `${MINIAPP_URL}?startapp=<chat_id>`, so the Worker can membership-verify the
   * launch. Optional: deploys without it simply omit the button.
   */
  MINIAPP_URL?: string;
  /**
   * Live per-con schedule store, keyed by ConId (`fureh` | `tos` | `canfurence`).
   * GET /api/schedule reads this FIRST; a hit is served as-is, a miss falls back to
   * the baked static asset. Writing a key lets a schedule change go live without a
   * redeploy. Local dev/tests get a real miniflare-backed KV from the vitest pool.
   */
  SCHEDULES: KVNamespace;
  /**
   * Static-asset binding (the `assets` block in wrangler.jsonc). Lets the Worker
   * `env.ASSETS.fetch(url)` the baked ./dist/data/<con>.json as the schedule
   * fallback when SCHEDULES has no live override.
   */
  ASSETS: Fetcher;
}
