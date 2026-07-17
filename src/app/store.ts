import { useEffect, useState } from 'preact/hooks';

/**
 * Minimal observable store — one value, subscribe/notify. Keeps the SPA's
 * shared state (stars, settings) framework-light and easy to unit-test without
 * rendering. `useStore` re-renders a component when the value changes.
 */
export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (prev: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    update(fn) {
      this.set(fn(value));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe a component to a store and get its current value. */
export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
  return value;
}
