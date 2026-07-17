/**
 * Telegram Mini App launch data — read from the URL fragment, NOT the Telegram
 * SDK script. Telegram launches a Mini App with its signed launch data in the
 * hash, e.g.
 *   #tgWebAppData=<url-encoded initData>&tgWebAppStartParam=-100123&tgWebAppVersion=7.0
 * Reading this directly avoids loading telegram.org/js/telegram-web-app.js (a
 * third-party runtime request the privacy sweep forbids).
 *
 * `tgWebAppData` IS the exact signed `initData` string the Worker's
 * `verifyInitData` HMACs. It MUST reach the Worker BYTE-FOR-BYTE: URLSearchParams
 * decodes the ONE outer layer of percent-encoding the fragment applied, handing
 * back the initData query string verbatim. We never decode-then-re-encode it —
 * re-encoding would change the string and break the HMAC.
 *
 * The `user` we parse here is DISPLAY-ONLY. Identity is ALWAYS derived server-
 * side from the verified initData, never trusted from this client parse. Treat
 * `initData` (and the user blob) as SENSITIVE: it is never logged.
 */

/** Display-only user, best-effort from the initData `user` JSON blob. */
export interface TgUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
}

/** The parsed launch parameters (pure — no `window` read). */
export interface TelegramLaunch {
  /** RAW signed initData for the Worker, verbatim. Null when absent/empty. */
  initData: string | null;
  /**
   * `tgWebAppStartParam` from the fragment — an UNTRUSTED launch hint. The hash
   * is attacker-controllable, so this MUST NOT authorize or select a crew
   * server-side: the Worker derives the authoritative crew from the HMAC-verified
   * `initData` (its signed `chat`/`start_param`), never from a client value.
   */
  startParam: string | null;
  /** Display-only user; null on any parse failure. */
  user: TgUser | null;
  /** `auth_date` (unix seconds) if present and numeric, else null. */
  authDate: number | null;
}

/** A launch plus the derived `isTelegram` flag. */
export type TelegramSession = TelegramLaunch & { isTelegram: boolean };

/** Coerce an unknown JSON value into a display TgUser, or null. */
function toTgUser(value: unknown): TgUser | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'number' || typeof o.first_name !== 'string') return null;
  const user: TgUser = { id: o.id, firstName: o.first_name };
  if (typeof o.last_name === 'string') user.lastName = o.last_name;
  if (typeof o.username === 'string') user.username = o.username;
  return user;
}

/** Best-effort display fields from a raw initData string. Never throws. */
function parseDisplayFields(initData: string): { user: TgUser | null; authDate: number | null } {
  const params = new URLSearchParams(initData);

  const authDateRaw = params.get('auth_date');
  const authDateNum = authDateRaw === null || authDateRaw === '' ? NaN : Number(authDateRaw);
  const authDate = Number.isFinite(authDateNum) ? authDateNum : null;

  const userRaw = params.get('user');
  if (userRaw === null || userRaw === '') return { user: null, authDate };
  try {
    return { user: toTgUser(JSON.parse(userRaw)), authDate };
  } catch {
    return { user: null, authDate };
  }
}

/**
 * PURE: parse a launch hash into {@link TelegramLaunch}. Strips a leading `#`,
 * reads via URLSearchParams (which does the single outer decode), and keeps
 * `tgWebAppData` verbatim as `initData`. Never throws on malformed input.
 */
export function parseLaunchParams(hash: string): TelegramLaunch {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

  const rawInitData = params.get('tgWebAppData');
  const initData = rawInitData === null || rawInitData === '' ? null : rawInitData;

  const rawStartParam = params.get('tgWebAppStartParam');
  const startParam = rawStartParam === null || rawStartParam === '' ? null : rawStartParam;

  if (initData === null) return { initData: null, startParam, user: null, authDate: null };
  const { user, authDate } = parseDisplayFields(initData);
  return { initData, startParam, user, authDate };
}

function toSession(launch: TelegramLaunch): TelegramSession {
  return { ...launch, isTelegram: launch.initData !== null };
}

// Capture the launch hash ONCE at module load, before any later code (routing,
// `configureNow`, history edits) can mutate the URL. The `window` read lives
// behind this function so tests exercise `parseLaunchParams` with synthetic
// strings instead of poking the global.
function readBootHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

const bootSession: TelegramSession = toSession(parseLaunchParams(readBootHash()));

/** The memoized session captured at boot. `isTelegram` is false on plain web. */
export function getTelegramSession(): TelegramSession {
  return bootSession;
}
