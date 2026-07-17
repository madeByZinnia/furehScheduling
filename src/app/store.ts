import { useEffect, useState } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';

/**
 * Minimal observable store — one value, subscribe/notify. Keeps the SPA's
 * shared state (stars, settings) framework-light and easy to unit-test without
 * rendering. `useStore` re-renders a component when the value changes.
 */
export interface Store<T> {
  get: () => T;
  set: (next: T) => void;
  update: (fn: (prev: T) => T) => void;
  // Property (not method) signatures: the impl returns bound arrow functions, so
  // these can be passed unbound (e.g. straight into useSyncExternalStore).
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();

  // Arrow functions (not `this`-bound methods) so the store's methods can be
  // passed unbound — e.g. `store.subscribe` straight into useSyncExternalStore.
  const get = () => value;
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const l of listeners) l();
  };
  const update = (fn: (prev: T) => T) => set(fn(value));
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, set, update, subscribe };
}

/** Subscribe a component to a store and get its current value. */
export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
  return value;
}

/**
 * Subscribe to a derived slice of a store, re-rendering only when that slice
 * changes (Object.is). Lets one row watch just its own flag without re-rendering
 * on every unrelated change to the whole value.
 *
 * Built on useSyncExternalStore so getSnapshot always uses the LATEST selector
 * closure — passing an inline `(v) => v.has(id)` is safe even if `id` changes.
 * The snapshot must be a primitive (or a stable reference); returning a fresh
 * object each call would loop.
 */
export function useStoreSelector<T, S>(store: Store<T>, selector: (value: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
