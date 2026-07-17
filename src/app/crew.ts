import { useEffect, useState } from 'preact/hooks';
import { createStore } from './store';
import { fetchRoster, subscribeSynced, type Roster, type RosterResult } from './crewSync';
import { getTelegramSession } from './telegram-session';

/**
 * Shared crew roster store. One cached roster feeds BOTH the Crew tab (member
 * list) and the Schedule tab ("also going" chips + the whose-favourites picker),
 * so we fetch it once rather than per consumer.
 *
 * States mirror crewSync's RosterResult, plus `idle` (never loaded) and
 * `loading` (first load only). A refresh (manual or a landed sync) replaces the
 * roster IN PLACE without dropping back to `loading` — otherwise the Schedule
 * chips would flicker away on every background sync. A background refresh that
 * fails keeps the last good roster rather than clobbering it with an error.
 */

export type CrewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'non-telegram' }
  | { kind: 'ok'; roster: Roster }
  | { kind: 'error' };

const store = createStore<CrewState>({ kind: 'idle' });

/** Injectable for tests; defaults to the real roster pull for the boot session. */
let loader: () => Promise<RosterResult> = () => fetchRoster(getTelegramSession());
let inflight = false;
let pending = false;

function fromResult(result: RosterResult): CrewState {
  if (result.kind === 'non-telegram') return { kind: 'non-telegram' };
  if (result.kind === 'error') return { kind: 'error' };
  return { kind: 'ok', roster: result.roster };
}

async function doLoad(): Promise<void> {
  if (inflight) {
    // A refresh asked for mid-load (e.g. the boot star-sync landing while the
    // very first roster fetch is still in flight) must not be dropped — coalesce
    // it and run once, after the current load settles. Otherwise the pre-sync
    // roster would win and the member wouldn't see their own just-synced stars.
    pending = true;
    return;
  }
  inflight = true;
  const prev = store.get();
  // Show a spinner only when there's nothing to show yet; a refresh keeps the
  // current roster visible until the new one lands.
  if (prev.kind === 'idle') store.set({ kind: 'loading' });
  try {
    const next = fromResult(await loader());
    // A transient refresh FAILURE keeps the last good roster rather than
    // clobbering it — fetchRoster reports network/HTTP failures as
    // { kind: 'error' } (it never rejects), so this must be handled here too,
    // not only in the catch below.
    if (!(next.kind === 'error' && prev.kind === 'ok')) store.set(next);
  } catch {
    if (prev.kind !== 'ok') store.set({ kind: 'error' });
  } finally {
    inflight = false;
    if (pending) {
      pending = false;
      void doLoad();
    }
  }
}

/** Trigger the first load if the roster has never been fetched. */
export function ensureCrewLoaded(): void {
  if (store.get().kind === 'idle') void doLoad();
}

/** Force a reload (Retry / Refresh button, or a landed sync). */
export function refreshCrew(): void {
  void doLoad();
}

/**
 * Re-fetch whenever THIS device's sync lands (throttled by the push debounce).
 * Wire once at boot. Returns an unsubscribe.
 */
export function startCrewAutoRefresh(): () => void {
  return subscribeSynced(() => {
    void doLoad();
  });
}

/** Reactive crew state; triggers the first load on mount. */
export function useCrew(): CrewState {
  const [state, setState] = useState(store.get());
  useEffect(() => {
    const unsubscribe = store.subscribe(() => setState(store.get()));
    ensureCrewLoaded();
    return unsubscribe;
  }, []);
  return state;
}

/** Test-only: swap the roster loader. */
export function __setCrewLoader(fn: () => Promise<RosterResult>): void {
  loader = fn;
}

/** Test-only: reset to the un-loaded state. */
export function __resetCrew(): void {
  inflight = false;
  pending = false;
  store.set({ kind: 'idle' });
}
