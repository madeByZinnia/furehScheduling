import type { OccurrenceId } from '../data/ids';
import { createStore, useStore, useStoreSelector } from './store';

/**
 * Local stars — per OCCURRENCE, not per item. Starring "Registration" must star
 * exactly the slot you tapped, not all 5 of its occurrences; the id is already
 * keyed on code+start, so we just store the set of OccurrenceIds. This is the
 * pre-backend solo store; M2 syncs it to crew state.
 */

const KEY = 'fureh.stars.v1';

function load(): Set<OccurrenceId> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is OccurrenceId => typeof x === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function persist(set: Set<OccurrenceId>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Private-mode / quota — keep the in-memory set; nothing else we can do.
  }
}

const store = createStore<Set<OccurrenceId>>(load());

export function isStarred(id: OccurrenceId): boolean {
  return store.get().has(id);
}

export function toggleStar(id: OccurrenceId): void {
  const next = new Set(store.get());
  if (next.has(id)) next.delete(id);
  else next.add(id);
  persist(next);
  store.set(next);
}

/**
 * Bulk union: add many occurrence ids at once (paste-import from fur-eh
 * favourites). Unions into the existing set — already-starred ids are a no-op —
 * and persists once. If nothing new is added, the store reference is left
 * untouched so subscribers don't re-render pointlessly.
 */
export function addStars(ids: OccurrenceId[]): void {
  const current = store.get();
  const next = new Set(current);
  for (const id of ids) next.add(id);
  if (next.size === current.size) return; // no new ids — nothing changed
  persist(next);
  store.set(next);
}

export function starCount(): number {
  return store.get().size;
}

/** Reactive: re-renders only when THIS occurrence's starred flag flips. */
export function useIsStarred(id: OccurrenceId): boolean {
  return useStoreSelector(store, (set) => set.has(id));
}

/** Reactive: the full set of starred occurrence ids. */
export function useStars(): Set<OccurrenceId> {
  return useStore(store);
}

/**
 * Non-React subscription for the crew-sync orchestrator: fires whenever the
 * starred set changes. Returns an unsubscribe. Thin wrapper over the private
 * store's subscribe so the store itself stays module-private.
 */
export function subscribeStars(cb: () => void): () => void {
  return store.subscribe(cb);
}

/** Current starred occurrence ids as an array (order not guaranteed). */
export function getStarsSnapshot(): OccurrenceId[] {
  return [...store.get()];
}

/** Test-only: reset to empty (and clear storage). */
export function __resetStars(): void {
  persist(new Set());
  store.set(new Set());
}
