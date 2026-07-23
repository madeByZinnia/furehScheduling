import { conKey } from './con';
import { createStore, useStore } from './store';

/**
 * Ghost mode — a per-device boolean that rides along with the crew sync. When ON,
 * the user's stars are pushed to the crew but the Worker marks their roster entry
 * `ghost: true` (present-but-hidden). Default OFF (false): opting into visibility
 * loudly is the safe default; ghosting is a deliberate choice.
 *
 * Mirrors settings.ts: a localStorage-backed observable with a safe try/catch,
 * plus a non-React `subscribeGhost` for the crewSync orchestrator to observe.
 */

const KEY = conKey('ghost.v1');

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — keep the in-memory value */
  }
}

function readGhost(): boolean {
  return safeGet(KEY) === 'true';
}

const store = createStore<boolean>(readGhost());

/** Current ghost flag (non-React). */
export function getGhost(): boolean {
  return store.get();
}

/** Set ghost on/off — persists and notifies subscribers. */
export function setGhost(on: boolean): void {
  safeSet(KEY, on ? 'true' : 'false');
  store.set(on);
}

/** Reactive: re-renders when the ghost flag flips. */
export function useGhost(): boolean {
  return useStore(store);
}

/** Non-React subscription for the sync orchestrator. Returns an unsubscribe. */
export function subscribeGhost(cb: () => void): () => void {
  return store.subscribe(cb);
}

/** Test-only: reset to default OFF (and clear storage). */
export function __resetGhost(): void {
  safeSet(KEY, 'false');
  store.set(false);
}
