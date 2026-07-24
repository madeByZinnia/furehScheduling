/**
 * Con-local date/time formatting. Everything is rendered in the ACTIVE con's
 * timezone (`activeCon().tz`) regardless of device timezone (travellers are on
 * Pacific/Central). No date library — no DST transition during a con, so
 * Intl.DateTimeFormat suffices.
 *
 * Constructing Intl.DateTimeFormat isn't free, so each formatter kind is cached
 * per-timezone: the first call for a given tz builds it, subsequent calls reuse.
 */

import { activeCon } from './con';

type FmtOptions = Intl.DateTimeFormatOptions;

/** One cache per formatter kind, keyed by timezone. */
function tzFormatterFactory(options: FmtOptions): (tz: string) => Intl.DateTimeFormat {
  const byTz = new Map<string, Intl.DateTimeFormat>();
  return (tz) => {
    let fmt = byTz.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...options });
      byTz.set(tz, fmt);
    }
    return fmt;
  };
}

const timeFmtFor = tzFormatterFactory({ hour: 'numeric', minute: '2-digit', hour12: true });
const weekdayShortFmtFor = tzFormatterFactory({ weekday: 'short' });
const weekdayLongFmtFor = tzFormatterFactory({ weekday: 'long' });
const dayNumFmtFor = tzFormatterFactory({ month: 'short', day: 'numeric' });

/** e.g. "10:00 a.m." in con-local time. */
export const formatTime = (iso: string): string => timeFmtFor(activeCon().tz).format(new Date(iso));

/** e.g. "Thu" — short weekday for a day tab. */
export const formatWeekdayShort = (iso: string): string =>
  weekdayShortFmtFor(activeCon().tz).format(new Date(iso));

/** e.g. "Thursday" — full weekday for aria labels. */
export const formatWeekdayLong = (iso: string): string =>
  weekdayLongFmtFor(activeCon().tz).format(new Date(iso));

/** e.g. "Jul 16" — month/day for a day tab subtitle. */
export const formatDayNum = (iso: string): string =>
  dayNumFmtFor(activeCon().tz).format(new Date(iso));
