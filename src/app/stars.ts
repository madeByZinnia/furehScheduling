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

/** Test-only: reset to empty (and clear storage). */
export function __resetStars(): void {
  persist(new Set());
  store.set(new Set());
}
