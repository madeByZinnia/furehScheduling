/**
 * Con-local date/time formatting. Everything is America/Edmonton regardless of
 * device timezone (travellers are on Pacific/Central). No date library — no DST
 * transition during the con, so Intl.DateTimeFormat suffices.
 */

const TZ = 'America/Edmonton';

const timeFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const weekdayShortFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, weekday: 'short' });
const weekdayLongFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, weekday: 'long' });
const dayNumFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  month: 'short',
  day: 'numeric',
});

/** e.g. "10:00 a.m." in con-local time. */
export const formatTime = (iso: string): string => timeFmt.format(new Date(iso));

/** e.g. "Thu" — short weekday for a day tab. */
export const formatWeekdayShort = (iso: string): string => weekdayShortFmt.format(new Date(iso));

/** e.g. "Thursday" — full weekday for aria labels. */
export const formatWeekdayLong = (iso: string): string => weekdayLongFmt.format(new Date(iso));

/** e.g. "Jul 16" — month/day for a day tab subtitle. */
export const formatDayNum = (iso: string): string => dayNumFmt.format(new Date(iso));
