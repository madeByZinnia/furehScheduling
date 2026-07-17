import { createStore, useStore } from './store';

/**
 * Custom display name — a per-device name the user picks for how the crew sees
 * them. Empty string means "use my Telegram name" (the Worker falls back to the
 * verified Telegram name when the synced name is blank). Rides along with the
 * crew sync like ghost/stars.
 *
 * Mirrors ghost.ts: a localStorage-backed observable with a safe try/catch, plus
 * a non-React `subscribeDisplayName` for the crewSync orchestrator to observe.
 */

const KEY = 'fureh.displayName.v1';

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

const store = createStore<string>(safeGet(KEY) ?? '');

/** Current custom display name (may be empty → use the Telegram name). Non-React. */
export function getDisplayName(): string {
  return store.get();
}

/** Set the custom display name — persists and notifies subscribers. */
export function setDisplayName(name: string): void {
  safeSet(KEY, name);
  store.set(name);
}

/** Reactive: re-renders when the custom display name changes. */
export function useDisplayName(): string {
  return useStore(store);
}

/** Non-React subscription for the sync orchestrator. Returns an unsubscribe. */
export function subscribeDisplayName(cb: () => void): () => void {
  return store.subscribe(cb);
}

/** Test-only: reset to empty (and clear storage). */
export function __resetDisplayName(): void {
  safeSet(KEY, '');
  store.set('');
}
