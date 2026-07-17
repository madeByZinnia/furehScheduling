import { describe, it, expect } from 'vitest';
import { parseNowParam, configureNow, now, isTimeTravelling } from './now';

describe('parseNowParam', () => {
  it('parses a full ISO instant with offset', () => {
    expect(parseNowParam('?now=2026-07-18T13:05:00-06:00')).toBe(
      Date.parse('2026-07-18T13:05:00-06:00'),
    );
  });

  it('returns null when absent or unparseable', () => {
    expect(parseNowParam('')).toBeNull();
    expect(parseNowParam('?foo=bar')).toBeNull();
    expect(parseNowParam('?now=not-a-date')).toBeNull();
  });
});

describe('configureNow / now', () => {
  it('overrides the current instant when ?now= is present', () => {
    configureNow('?now=2026-07-18T13:05:00-06:00');
    expect(isTimeTravelling()).toBe(true);
    expect(now().toISOString()).toBe(new Date('2026-07-18T13:05:00-06:00').toISOString());
  });

  it('falls back to real time when no override', () => {
    configureNow('');
    expect(isTimeTravelling()).toBe(false);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
