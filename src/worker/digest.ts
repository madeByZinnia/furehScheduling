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

const CON_TZ = 'America/Edmonton';
const timeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CON_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
// Con-local calendar day (YYYY-MM-DD) — used to tell "opens later today" from
// "opens a later day", regardless of the server's timezone.
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CON_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
// Short weekday (e.g. "Sat") for an ambient venue that next opens on a later day.
const weekdayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CON_TZ,
  weekday: 'short',
});

/** HH:MM in con-local time, regardless of server timezone. */
function conTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** Con-local calendar day of an instant, so "today" is the con's day, not UTC's. */
function conDay(when: Date): string {
  return dayFormatter.format(when);
}

/**
 * An ambient venue runs far longer than any panel: Registration, the Dealer's
 * Den, the Art Show, the lounges. 25 baked blocks run >6h; every one of them is a
 * place that is simply "open", not a session that is "happening". The threshold
 * is data-driven (no hardcoded venue list) — exactly those 25 blocks exceed it.
 */
const AMBIENT_MIN_MS = 6 * 60 * 60 * 1000;

function isAmbient(o: DigestOccurrence): boolean {
  return Date.parse(o.end) - Date.parse(o.start) > AMBIENT_MIN_MS;
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
 * The "Also open" footer: ambient venues never lead the digest, they sit here as
 * one line each showing their NEXT transition — "closes 18:00" while open,
 * "opens 14:00" if they reopen later today, "opens Sat" for a later day. Venues
 * whose last block has ended are dropped. Blocks of the same venue are grouped by
 * title. Returns [] (no footer at all) when nothing ambient is open or upcoming.
 */
function ambientFooter(occurrences: DigestOccurrence[], now: Date): string[] {
  const t = now.getTime();
  const nowDay = conDay(now);

  const byVenue = new Map<string, DigestOccurrence[]>();
  for (const o of occurrences) {
    if (!isAmbient(o)) continue;
    const blocks = byVenue.get(o.title);
    if (blocks !== undefined) blocks.push(o);
    else byVenue.set(o.title, [o]);
  }

  // phase 0 = open now (sorted by soonest close), phase 1 = upcoming (by soonest open).
  const entries: { title: string; phase: number; sortKey: number; label: string }[] = [];
  for (const [title, blocks] of byVenue) {
    blocks.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const openNow = blocks.find((b) => Date.parse(b.start) <= t && t < Date.parse(b.end));
    if (openNow !== undefined) {
      entries.push({ title, phase: 0, sortKey: Date.parse(openNow.end), label: `closes ${conTime(openNow.end)}` });
      continue;
    }
    const next = blocks.find((b) => Date.parse(b.start) > t);
    if (next === undefined) continue; // every block for this venue has ended → drop it
    const opensToday = conDay(new Date(next.start)) === nowDay;
    const label = opensToday
      ? `opens ${conTime(next.start)}`
      : `opens ${weekdayFormatter.format(new Date(next.start))}`;
    entries.push({ title, phase: 1, sortKey: Date.parse(next.start), label });
  }
  if (entries.length === 0) return [];

  // Open venues first, then upcoming; within each, soonest transition, then title.
  entries.sort(
    (a, b) =>
      a.phase - b.phase ||
      a.sortKey - b.sortKey ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
  );

  const lines = ['', '<b>Also open</b>'];
  for (const e of entries) lines.push(`${escapeHtml(e.title)} — ${e.label}`);
  return lines;
}

/** Build the digest text for the instant `now`, from the given occurrences. */
export function buildDigest(occurrences: DigestOccurrence[], now: Date): string {
  const t = now.getTime();
  // Ambient venues (>6h blocks) never lead — they're pulled out of the headline
  // sections and rendered in the "Also open" footer instead.
  const panels = occurrences.filter((o) => !isAmbient(o));
  const happening = panels
    .filter((o) => Date.parse(o.start) <= t && t < Date.parse(o.end))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const upcoming = panels
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
    for (const o of upcoming.slice(0, MAX_NEXT)) lines.push(line(`${escapeHtml(conTime(o.start))} `, o));
  }

  lines.push(...ambientFooter(occurrences, now));

  return lines.join('\n');
}
