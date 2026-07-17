import type { TelegramSession } from './telegram-session';
import { getTelegramSession } from './telegram-session';
import { subscribeStars, getStarsSnapshot } from './stars';
import { subscribeGhost, getGhost } from './ghost';

/**
 * Crew sync — the client half of the crew roster. It pushes THIS device's stars
 * (plus the ghost flag) up to the Worker and pulls back the whole crew's roster.
 *
 * SECURE CONTRACT: we send the RAW signed `initData` and the payload, but NEVER a
 * `chatId`. The Worker derives the authoritative crew from the HMAC-verified
 * initData — a client-supplied chat id is forgeable and must not select a crew.
 * `initData` is SENSITIVE: it is never logged, nor is any response echoed in a way
 * that could leak it.
 *
 * Everything here is a no-op on plain web (non-Telegram): there is no signed
 * identity to sync under, so the local stars store simply stays solo. Network
 * failures NEVER throw to the caller — a flaky push must not break the UI.
 *
 * Types mirror the Worker's RosterEntry/RosterPlan by hand; we deliberately do
 * NOT import worker code into the SPA bundle.
 */

export interface RosterPlan {
  occurrenceId: string;
  title?: string;
  start?: string;
  room?: string;
}

export interface RosterEntry {
  userId: number;
  displayName: string;
  ghost: boolean;
  plans: RosterPlan[];
}

export type Roster = RosterEntry[];

/**
 * The four distinct outcomes of a roster pull, kept separate so the UI can tell
 * them apart:
 *  - `non-telegram`: plain web — there is no signed identity to sync under. Not
 *    an error; the UI nudges the user to open in Telegram.
 *  - `ok`: a validated roster (which may legitimately be EMPTY, e.g. a solo crew).
 *  - `error`: a network reject, a non-2xx status, OR a malformed body. The UI can
 *    surface a real failure + Retry.
 * Collapsing these into a single `null` made the error/Retry state unreachable and
 * mislabelled genuine failures as "Open in Telegram".
 */
export type RosterResult =
  | { kind: 'non-telegram' }
  | { kind: 'ok'; roster: Roster }
  | { kind: 'error' };

/** The POST /api/sync body. Note: NO chatId — the Worker derives the crew. */
export interface SyncBody {
  initData: string;
  ghost: boolean;
  stars: string[];
}

/**
 * PURE: build the sync body from an explicit session + state. Returns null when
 * there is nothing to sync (plain web, or no signed initData) — the caller then
 * no-ops. Never includes a chatId.
 */
export function buildSyncBody(
  session: TelegramSession,
  ghost: boolean,
  stars: string[],
): SyncBody | null {
  if (!session.isTelegram || session.initData == null) return null;
  return { initData: session.initData, ghost, stars };
}

/**
 * Push {initData, ghost, stars} to the Worker. Returns true on a 2xx, false on a
 * no-op (non-Telegram), a non-ok status, or ANY network error. Never throws.
 * Never logs initData.
 */
export async function postSync(
  session: TelegramSession,
  ghost: boolean,
  stars: string[],
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const body = buildSyncBody(session, ghost, stars);
  if (body === null) return false;
  try {
    const res = await fetchFn('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Coerce one unknown value into a RosterPlan, or null if it isn't shaped like one. */
function toRosterPlan(value: unknown): RosterPlan | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.occurrenceId !== 'string') return null;
  const plan: RosterPlan = { occurrenceId: o.occurrenceId };
  if (typeof o.title === 'string') plan.title = o.title;
  if (typeof o.start === 'string') plan.start = o.start;
  if (typeof o.room === 'string') plan.room = o.room;
  return plan;
}

/** Coerce one unknown value into a RosterEntry, or null. Bad plans are dropped. */
function toRosterEntry(value: unknown): RosterEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.userId !== 'number' || typeof o.displayName !== 'string') return null;
  if (typeof o.ghost !== 'boolean' || !Array.isArray(o.plans)) return null;
  const plans: RosterPlan[] = [];
  for (const raw of o.plans) {
    const plan = toRosterPlan(raw);
    if (plan !== null) plans.push(plan);
  }
  return { userId: o.userId, displayName: o.displayName, ghost: o.ghost, plans };
}

/** Validate an unknown `roster` field into a typed Roster, or null. */
function toRoster(value: unknown): Roster | null {
  if (!Array.isArray(value)) return null;
  const roster: Roster = [];
  for (const raw of value) {
    const entry = toRosterEntry(raw);
    if (entry !== null) roster.push(entry);
  }
  return roster;
}

/**
 * Pull the crew roster from the Worker. NEVER throws to the caller. Returns a
 * {@link RosterResult} that distinguishes the four outcomes:
 *  - plain web (non-Telegram / no signed initData) → `{ kind: 'non-telegram' }`.
 *  - network reject, non-2xx status, or a body that fails defensive validation
 *    (including an entirely malformed top-level shape) → `{ kind: 'error' }`.
 *  - a valid roster, INCLUDING an empty array → `{ kind: 'ok', roster }`.
 * The parsed shape is validated defensively before being returned. Never logs
 * initData.
 */
export async function fetchRoster(
  session: TelegramSession,
  fetchFn: typeof fetch = fetch,
): Promise<RosterResult> {
  if (!session.isTelegram || session.initData == null) return { kind: 'non-telegram' };
  try {
    const res = await fetchFn('/api/roster', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: session.initData }),
    });
    if (!res.ok) return { kind: 'error' };
    const parsed = (await res.json()) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return { kind: 'error' };
    const roster = toRoster((parsed as Record<string, unknown>).roster);
    if (roster === null) return { kind: 'error' };
    return { kind: 'ok', roster };
  } catch {
    return { kind: 'error' };
  }
}

export interface AutoSyncOptions {
  /** Debounce window in ms before a change triggers a push. Default 800. */
  debounceMs?: number;
  /** Injected fetch for tests. Default the global fetch. */
  fetchFn?: typeof fetch;
}

const DEFAULT_DEBOUNCE_MS = 800;

/**
 * Wire the stars + ghost stores to a debounced push. On plain web this is a
 * no-op (returns a no-op unsubscribe). Otherwise it subscribes to both stores,
 * coalesces bursts of changes into ONE push per {@link AutoSyncOptions.debounceMs}
 * window, and fires one initial debounced push to seed the crew with local state.
 * The returned unsubscribe detaches both listeners AND clears any pending timer.
 */
export function startAutoSync(opts: AutoSyncOptions = {}): () => void {
  const session = getTelegramSession();
  if (!session.isTelegram || session.initData == null) return () => {};

  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const fetchFn = opts.fetchFn ?? fetch;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    // postSync never throws; the returned promise is intentionally not awaited.
    void postSync(session, getGhost(), getStarsSnapshot(), fetchFn);
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const unsubStars = subscribeStars(schedule);
  const unsubGhost = subscribeGhost(schedule);

  // Seed the crew with whatever is already local (also debounced).
  schedule();

  return () => {
    unsubStars();
    unsubGhost();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
