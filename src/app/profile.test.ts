import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDisplayName,
  setDisplayName,
  subscribeDisplayName,
  __resetDisplayName,
} from './profile';

describe('profile — custom display name store', () => {
  beforeEach(() => __resetDisplayName());

  it('defaults to empty (use the Telegram name)', () => {
    expect(getDisplayName()).toBe('');
  });

  it('set persists the value and notifies subscribers', () => {
    let fired = 0;
    const unsubscribe = subscribeDisplayName(() => {
      fired += 1;
    });
    setDisplayName('Zinnia');
    expect(getDisplayName()).toBe('Zinnia');
    expect(fired).toBe(1);
    unsubscribe();
  });

  it('reset clears back to empty', () => {
    setDisplayName('Zinnia');
    __resetDisplayName();
    expect(getDisplayName()).toBe('');
  });
});
