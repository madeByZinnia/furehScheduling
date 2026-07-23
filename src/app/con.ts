/**
 * Active-con singleton for the SPA runtime.
 *
 * The active con is resolved ONCE, SYNCHRONOUSLY, at module evaluation — every
 * source below is a synchronous read — so it is available before the other
 * stores (stars, settings) that key their storage on it initialize. Resolution
 * priority (first hit wins):
 *
 *   1. `?con=<id>` in the URL query        — explicit, sharable, highest signal.
 *   2. Telegram start_param `<conId>__<chatId>` hint (con id = leading token
 *      before the FIRST `__`).
 *   3. `localStorage['app.lastCon.v1']`     — the user's last-used con.
 *   4. date-window inference (today ∈ a con's dates) — LAST resort: ToS and
 *      Canfurence overlap, so this can be ambiguous; only used when nothing else
 *      answered.
 *   5. null — no con could be inferred.
 *
 * Every `window` / `localStorage` / `Intl` access in THIS module is guarded, so
 * resolution itself never throws under SSR / worker / test. (A transitively
 * imported module — e.g. `telegram-session` — parses the launch hash at its own
 * eval; that is pre-existing app behavior and out of scope here.)
 */

import { createStore, type Store } from './store';
import { getTelegramSession } from './telegram-session';
import { CONS, getCon, DEFAULT_CON, type ConConfig, type ConId } from '../data/cons';

/** localStorage key holding the user's last-used con id. */
const LAST_CON_KEY = 'app.lastCon.v1';

// ── pure resolution primitives (no globals — unit-testable directly) ─────────

/** 1. `?con=<id>` from a raw query string (leading `?` optional). */
function fromSearchStr(search: string): ConId | null {
  const raw = new URLSearchParams(search).get('con');
  if (!raw) return null;
  return getCon(raw)?.id ?? null;
}

/**
 * 2. Telegram `<conId>__<chatId>` hint — the con id is the LEADING token, so
 * split on the FIRST `__`. Con ids are a fixed enum with no `__`, and Telegram
 * chat ids are numeric (a possibly-negative integer, never containing `__`), so
 * the leading segment is unambiguous even though the trailing chat id is ignored
 * here. This mirrors the worker's crew-ref parse, which takes the chat id as
 * everything AFTER the first `__`.
 */
function fromStartParam(startParam: string | null): ConId | null {
  if (!startParam) return null;
  const idx = startParam.indexOf('__');
  const hint = idx >= 0 ? startParam.slice(0, idx) : startParam;
  return getCon(hint)?.id ?? null;
}

/** 3. Stored last-used con id (from `localStorage['app.lastCon.v1']`). */
function fromStoredId(storedId: string | null): ConId | null {
  if (!storedId) return null;
  return getCon(storedId)?.id ?? null;
}

/** Cache one day-formatter per timezone (constructing `Intl` is not free). */
const dayFmtByTz = new Map<string, Intl.DateTimeFormat>();

/** `now` as a `YYYY-MM-DD` calendar date IN the given timezone (en-CA → ISO). */
function conLocalYmd(now: Date, tz: string): string {
  try {
    let fmt = dayFmtByTz.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      dayFmtByTz.set(tz, fmt);
    }
    return fmt.format(now);
  } catch {
    return ''; // never-match sentinel; keeps resolution total
  }
}

/**
 * 4. LAST resort: `now` falling within a con's inclusive date window, evaluated
 * in THAT con's timezone (not the device's) — a UTC-host midnight must not shift
 * the con-local calendar day. Ambiguous when cons overlap (ToS ⊂ Canfurence), so
 * this is only reached when nothing more specific answered.
 */
function fromDate(now: Date): ConId | null {
  for (const con of Object.values(CONS)) {
    const ymd = conLocalYmd(now, con.tz);
    if (ymd !== '' && ymd >= con.dates.start && ymd <= con.dates.end) return con.id;
  }
  return null;
}

/**
 * PURE resolver: runs the full priority chain over explicit inputs, no globals.
 * Tests drive this directly (no module-reset gymnastics); the singleton wrappers
 * below feed it the live `window` / `localStorage` / clock values.
 */
export function resolveConId(
  search: string,
  startParam: string | null,
  storedId: string | null,
  now: Date,
): ConId | null {
  return (
    fromSearchStr(search) ??
    fromStartParam(startParam) ??
    fromStoredId(storedId) ??
    fromDate(now) ??
    null
  );
}

// ── global readers (each guarded so import stays SSR/worker/test-safe) ────────

/** Read `window.location.search`, defensively. */
function readSearch(): string {
  try {
    if (typeof window === 'undefined') return '';
    return window.location.search;
  } catch {
    return '';
  }
}

/**
 * Read the Telegram launch start param. Prefers the memoized, already-parsed
 * accessor; falls back to a defensive re-parse of the URL fragment so a null
 * from the accessor (e.g. captured before the hash was set) still has a chance.
 */
function readStartParam(): string | null {
  try {
    const sp = getTelegramSession().startParam;
    if (sp) return sp;
  } catch {
    // fall through to the hash re-parse
  }
  try {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    return params.get('tgWebAppStartParam');
  } catch {
    return null;
  }
}

/** Read `localStorage['app.lastCon.v1']`, defensively. */
function readStoredId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LAST_CON_KEY);
  } catch {
    return null;
  }
}

/** Run the full priority chain against live globals. Returns the id, or null. */
function resolveActiveCon(): ConId | null {
  return resolveConId(readSearch(), readStartParam(), readStoredId(), new Date());
}

// Resolved synchronously at module eval — before other stores initialize.
let resolved: ConId | null = resolveActiveCon();

/** Store of the active con id (null when none could be inferred). */
export const conStore: Store<ConId | null> = createStore<ConId | null>(resolved);

/** The resolved con config, falling back to the default when none was inferred. */
export function activeCon(): ConConfig {
  return getCon(resolved ?? DEFAULT_CON)!;
}

/**
 * Namespace a storage suffix under the active con's storageKey (or 'fureh' when
 * unresolved), e.g. `conKey('stars.v1')` → `'tos.stars.v1'`.
 */
export function conKey(suffix: string): string {
  const con = resolved ? getCon(resolved) : null;
  return `${con?.storageKey ?? 'fureh'}.${suffix}`;
}

/** Switch the active con: persist it, update the singleton and the store. */
export function setActiveCon(id: ConId): void {
  resolved = id;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_CON_KEY, id);
  } catch {
    // Private-mode / quota — keep the in-memory value; nothing else we can do.
  }
  conStore.set(id);
}
