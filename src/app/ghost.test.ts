import { describe, it, expect, beforeEach } from 'vitest';
import { getGhost, setGhost, subscribeGhost, __resetGhost } from './ghost';

describe('ghost — persisted boolean, default off', () => {
  beforeEach(() => __resetGhost());

  it('defaults to false', () => {
    expect(getGhost()).toBe(false);
  });

  it('setGhost persists and getGhost reflects it', () => {
    setGhost(true);
    expect(getGhost()).toBe(true);
    expect(localStorage.getItem('fureh.ghost.v1')).toBe('true');

    setGhost(false);
    expect(getGhost()).toBe(false);
    expect(localStorage.getItem('fureh.ghost.v1')).toBe('false');
  });

  it('subscribeGhost fires on change and unsubscribes cleanly', () => {
    let fired = 0;
    const unsub = subscribeGhost(() => {
      fired += 1;
    });
    setGhost(true);
    expect(fired).toBe(1);

    // Object.is short-circuit: setting the same value does not re-notify.
    setGhost(true);
    expect(fired).toBe(1);

    setGhost(false);
    expect(fired).toBe(2);

    unsub();
    setGhost(true);
    expect(fired).toBe(2);
  });
});
