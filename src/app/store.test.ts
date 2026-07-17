import { describe, it, expect, vi } from 'vitest';
import { createStore } from './store';

describe('createStore', () => {
  it('gets, sets, and notifies subscribers', () => {
    const s = createStore(1);
    const seen: number[] = [];
    s.subscribe(() => seen.push(s.get()));
    s.set(2);
    s.update((n) => n + 10);
    expect(s.get()).toBe(12);
    expect(seen).toEqual([2, 12]);
  });

  it('skips notification when the value is Object.is-equal', () => {
    const s = createStore(5);
    const spy = vi.fn();
    s.subscribe(spy);
    s.set(5); // same value → no notify
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const s = createStore(0);
    const spy = vi.fn();
    const off = s.subscribe(spy);
    s.set(1);
    off();
    s.set(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
