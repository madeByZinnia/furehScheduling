/**
 * The pinned "Happening Now" digest — a pure text builder, so property tests can
 * hammer it directly (no network, no DO). It takes `now` as an argument rather
 * than reading a clock, which is what lets `?now=` time-travel drive it.
 *
 * Output is restricted to Telegram's inline-HTML whitelist (here: <b> and <i>).
 * All dynamic text is HTML-escaped so a session titled "A < B" cannot inject a
 * tag and make the Bot API reject the entire message.
 */

/** The minimal occurrence shape the digest needs (a subset of the SPA's). */
export interface DigestOccurrence {
  title: string;
  room: string | null;
  start: string; // ISO 8601 with offset
  end: string; // ISO 8601 with offset
}

// Building an Intl.DateTimeFormat is not free, and the digest formats several
// lines per call, so memoize one formatter per IANA timezone. The map is keyed on
// the timezone string, so a multi-con Worker (Edmonton, Vancouver, Toronto, …)
// keeps a tiny bounded cache instead of rebuilding a formatter per occurrence.
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let fmt = timeFormatters.get(timezone);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    timeFormatters.set(timezone, fmt);
  }
  return fmt;
}

/** HH:MM in the con's local time, regardless of server timezone. */
function conTime(iso: string, timezone: string): string {
  return formatterFor(timezone).format(new Date(iso));
}

/** Escape the three characters Telegram's HTML parser treats specially. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MAX_NOW = 8;
const MAX_NEXT = 5;

function line(prefix: string, o: DigestOccurrence): string {
  const room = o.room !== null && o.room !== '' ? ` — <i>${escapeHtml(o.room)}</i>` : '';
  return `• ${prefix}${escapeHtml(o.title)}${room}`;
}

/**
 * Build the digest text for the instant `now`, from the given occurrences,
 * rendering coming-up times in `timezone` (the con's IANA tz). Each Crew DO
 * passes its own con's timezone, so one Worker serves multiple cons correctly.
 */
export function buildDigest(occurrences: DigestOccurrence[], now: Date, timezone: string): string {
  const t = now.getTime();
  const happening = occurrences
    .filter((o) => Date.parse(o.start) <= t && t < Date.parse(o.end))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const upcoming = occurrences
    .filter((o) => Date.parse(o.start) > t)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const lines: string[] = ['<b>Happening now</b>'];
  if (happening.length === 0) {
    lines.push('Nothing scheduled right now.');
  } else {
    for (const o of happening.slice(0, MAX_NOW)) lines.push(line('', o));
  }

  if (upcoming.length > 0) {
    lines.push('', '<b>Coming up</b>');
    for (const o of upcoming.slice(0, MAX_NEXT))
      lines.push(line(`${escapeHtml(conTime(o.start, timezone))} `, o));
  }

  return lines.join('\n');
}
