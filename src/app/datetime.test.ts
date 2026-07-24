import { describe, it, expect, afterEach } from 'vitest';
import { formatTime } from './datetime';
import { setActiveCon } from './con';

/**
 * datetime formatters must render in the ACTIVE con's timezone, not a hardcoded
 * one. This discriminates the "replace activeCon().tz with 'America/Edmonton'"
 * mutation: with the mutation, tos and fureh format identically and the first
 * assertion fails.
 */
describe('datetime — formats in the active con timezone', () => {
  afterEach(() => setActiveCon('fureh'));

  it('formatTime differs between a Vancouver con and an Edmonton con', () => {
    // 20:00 UTC → 13:00 (1 p.m.) in Vancouver (-07), 14:00 (2 p.m.) in Edmonton (-06).
    const iso = '2026-08-08T20:00:00Z';

    setActiveCon('tos'); // America/Vancouver
    const vancouver = formatTime(iso);

    setActiveCon('fureh'); // America/Edmonton
    const edmonton = formatTime(iso);

    expect(vancouver).not.toBe(edmonton);
    expect(vancouver).toContain('1:00');
    expect(edmonton).toContain('2:00');
  });
});
