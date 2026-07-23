/**
 * Client-only RFC 5545 (.ics) writer — three silent traps, all defused here.
 *
 * This module is pure (no I/O, no DOM) so the property tests can hammer it and
 * an export UI can call it in the browser. Get any of these wrong and Apple
 * Calendar imports NOTHING and shows NO error:
 *
 *  1. FOLDING. A content line longer than 75 OCTETS must be folded (CRLF + one
 *     space). The limit is BYTES, not characters — an emoji is 4 bytes, a CJK
 *     glyph is 3. A naive character-based fold splits a multi-byte UTF-8
 *     sequence across the boundary and corrupts the file. We fold on codepoint
 *     boundaries while counting octets, so a sequence is never cut in half.
 *     `unfold(fold(s)) === s` for arbitrary text.
 *
 *  2. ESCAPING. Backslash, semicolon, comma, and newlines must be escaped in
 *     TEXT values — and backslash MUST be escaped FIRST, or you double-escape
 *     the backslashes you just introduced. An unescaped `;` or `,` silently
 *     truncates the value on import.
 *
 *  3. UIDs. A per-occurrence UID keyed on the CODE alone (or on a slot index)
 *     collapses the four days of a repeating session ("Headless Lounge") into
 *     one calendar event. We key on `code + start` (the existing OccurrenceId
 *     scheme) so each slot is its own event: `${occurrenceId}@fureh-schedules`.
 *
 * All DTSTART/DTEND/DTSTAMP are emitted in UTC `Z` form; there is no VTIMEZONE
 * and no X-WR-TIMEZONE. VALARM is opt-in and OFF by default.
 */

import type { OccurrenceId } from '../data/ids';
import type { Occurrence } from '../data/expand';

const CRLF = '\r\n';

/** Max octets in one physical (unfolded) content line, per RFC 5545 §3.1. */
const MAX_OCTETS = 75;

/** Domain suffix that makes each occurrence UID globally unique to this app. */
export const UID_DOMAIN = 'fureh-schedules';

/** Minutes-before-start for the opt-in VALARM (TRIGGER:-PT10M). */
export const DEFAULT_REMINDER_MINUTES = 10;

const encoder = new TextEncoder();
const decoder = new TextDecoder(); // non-fatal: replaces bad bytes with U+FFFD

/** Octet (UTF-8 byte) length of a string. */
const octetLength = (s: string): number => encoder.encode(s).length;

/**
 * A lone (unpaired) UTF-16 surrogate — not a valid scalar value. Non-global so
 * it is safe to reuse across `.test()` calls (a /g regex carries lastIndex).
 */
const LONE_SURROGATE_STRUCTURAL =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** C0 control characters (U+0000–U+001F) plus DEL (U+007F). */
// eslint-disable-next-line no-control-regex -- matches C0 control chars + DEL by design
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Guard a STRUCTURED (non-TEXT) property value — UID, PRODID — that is inserted
 * verbatim into a content line. A CR/LF/NUL (or any other C0 control char) would
 * inject or truncate content lines and silently corrupt the whole calendar, so
 * we throw rather than emit it. TEXT fields (SUMMARY/LOCATION/DESCRIPTION) do
 * NOT use this: their newlines are legitimately escaped by {@link escapeText}.
 */
const assertStructuralValue = (name: string, value: string): void => {
  if (CONTROL_CHARS.test(value)) {
    throw new Error(
      `${name} must not contain control characters (CR/LF/NUL/etc.)`,
    );
  }
  // A lone surrogate here would become a hidden U+FFFD in the emitted UTF-8; a
  // structured value (unlike TEXT) is never sanitized, so reject it outright.
  if (LONE_SURROGATE_STRUCTURAL.test(value)) {
    throw new Error(`${name} must not contain unpaired surrogate code units`);
  }
};

/**
 * Fold a content line at 75 OCTETS. Continuation lines begin with CRLF then a
 * single space (which itself counts toward the 75). We iterate whole codepoints
 * (`Array.from` splits on codepoints, keeping surrogate pairs intact), so a
 * multi-byte UTF-8 sequence is never split across a fold boundary.
 */
export const fold = (line: string): string => {
  const physical: string[] = [];
  let current = '';
  let currentOctets = 0;

  for (const ch of Array.from(line)) {
    const chOctets = octetLength(ch);
    // First physical line gets the full 75; continuations reserve 1 octet for
    // the leading space marker, leaving 74 for content.
    const budget = physical.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (currentOctets + chOctets > budget && current !== '') {
      physical.push(current);
      current = '';
      currentOctets = 0;
    }
    current += ch;
    currentOctets += chOctets;
  }
  physical.push(current);

  return physical.map((l, i) => (i === 0 ? l : ' ' + l)).join(CRLF);
};

/** Inverse of {@link fold}: remove every CRLF-plus-space continuation marker. */
export const unfold = (s: string): string => s.replace(/\r\n /g, '');

/**
 * Replace any UNPAIRED UTF-16 surrogate with U+FFFD. A lone surrogate is not a
 * valid scalar value; when the string is UTF-8-encoded for the file, the encoder
 * silently substitutes U+FFFD, so `decode(encode(s)) !== s`. That hidden byte
 * mismatch would let `unfold(fold(s)) === s` pass on the JS string while the
 * emitted octets differ. We substitute deterministically up front so the output
 * string already equals its own UTF-8 round-trip. We do NOT throw: a user's odd
 * title must still export. (Structured fields are covered by Fix 1.)
 */
const replaceLoneSurrogates = (s: string): string =>
  s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '�',
  );

/**
 * Escape a TEXT value per RFC 5545 §3.3.11. Order matters: backslash FIRST, or
 * the backslashes we add for `;` `,` `\n` get doubled. All newline forms
 * (`\r\n`, lone `\r`, lone `\n`) normalize to the literal two-character `\n`.
 * Unpaired surrogates are first mapped to U+FFFD so the escaped value equals its
 * UTF-8 round-trip (see {@link replaceLoneSurrogates}).
 */
export const escapeText = (s: string): string =>
  replaceLoneSurrogates(s)
    .replace(/\\/g, '\\\\') // backslash FIRST
    .replace(/\r\n/g, '\\n') // normalize CRLF ...
    .replace(/\r/g, '\\n') // ... and lone CR ...
    .replace(/\n/g, '\\n') // ... and LF to a literal \n
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

/**
 * Inverse of {@link escapeText}, parsed left-to-right so `\\` un-escapes before
 * the `\;` / `\,` / `\n` sequences. `\n` and `\N` both become a newline (LF).
 */
export const unescapeText = (s: string): string =>
  s.replace(/\\(.)/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/**
 * ISO-8601 datetime carrying an EXPLICIT zone. We reject date-only values
 * (`2026-07-17`) and offset-less datetimes (`2026-07-17T10:00:00`): both are
 * interpreted against the browser's local timezone, so the emitted UTC instant
 * would depend on where the export ran. Requires `YYYY-MM-DDThh:mm`, optional
 * `:ss(.sss)`, then `Z` or `±hh:mm`.
 */
const ISO_ZONED_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Format an ISO-8601-with-offset instant as RFC 5545 UTC `Z` time
 * (`YYYYMMDDTHHMMSSZ`). Converts from whatever offset the input carries. The
 * input MUST carry an explicit zone (`Z` or `±hh:mm`) — see
 * {@link ISO_ZONED_DATETIME} — or the resulting instant would be timezone-
 * dependent. Rejects a resulting UTC year outside 0001–9999.
 */
export const formatUtc = (iso: string): string => {
  if (!ISO_ZONED_DATETIME.test(iso)) {
    throw new Error(`datetime must be ISO-8601 with explicit zone: ${iso}`);
  }
  // Accepted limitation: a syntactically valid but non-existent calendar date
  // (e.g. 2026-02-30) is normalized by the platform Date parser rather than
  // rejected. Real schedule/dtstamp inputs are always valid instants, so we do
  // not pay for offset-aware calendar validation here.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid datetime: ${iso}`);
  const year = d.getUTCFullYear();
  if (year < 1 || year > 9999) {
    throw new Error(`datetime year out of range (0001-9999): ${iso}`);
  }
  const p = (n: number): string => String(n).padStart(2, '0');
  // Four-digit year: years < 1000 must stay zero-padded (0007 -> "0007", never
  // "7"), or the basic-format date is malformed.
  const yyyy = String(year).padStart(4, '0');
  return (
    `${yyyy}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
};

/**
 * Stable, globally-unique UID for one occurrence: `${id}@${domain}`. The domain
 * defaults to {@link UID_DOMAIN} (Fureh) for back-compat; each con threads its
 * own `ics.uidDomain` so a UID never claims to belong to a different con's feed.
 */
export const occurrenceUid = (
  id: OccurrenceId,
  domain: string = UID_DOMAIN,
): string => `${id}@${domain}`;

/** A single VEVENT's data. Times are ISO-8601 with offset (converted to UTC). */
export interface IcsEvent {
  uid: string;
  /** ISO-8601 with offset. */
  start: string;
  /** ISO-8601 with offset. */
  end: string;
  summary: string;
  location?: string;
  description?: string;
}

export interface IcsOptions {
  /** DTSTAMP instant (ISO). Injectable for deterministic tests; default now. */
  dtstamp?: string;
  /** Product identifier for PRODID. */
  prodId?: string;
  /** Domain suffix for each occurrence UID (default {@link UID_DOMAIN}). */
  uidDomain?: string;
  /** Opt in to a VALARM on every event (default OFF). Uses 10 min unless overridden. */
  alarm?: boolean;
  /** Minutes-before-start for the VALARM; presence also enables the alarm. */
  reminderMinutes?: number;
}

const DEFAULT_PRODID = '-//fureh-schedules//Fur-Eh 2026 Schedule//EN';

/**
 * Build a complete VCALENDAR string. Every content line is folded, every TEXT
 * value escaped, and the output uses CRLF line endings throughout (including a
 * trailing CRLF on the final line, as RFC 5545 requires).
 *
 * DTSTAMP is a single injected/`now` instant applied to EVERY event so the
 * output is deterministic under test.
 */
export const buildIcs = (events: IcsEvent[], opts: IcsOptions = {}): string => {
  const dtstamp = formatUtc(opts.dtstamp ?? new Date().toISOString());
  const prodId = opts.prodId ?? DEFAULT_PRODID;
  assertStructuralValue('PRODID', prodId);
  // Alarm is OFF unless the caller opts in via `alarm` or a `reminderMinutes`.
  const minutes =
    opts.reminderMinutes ?? (opts.alarm ? DEFAULT_REMINDER_MINUTES : undefined);
  // Guard only caller-supplied minutes; the DEFAULT_REMINDER_MINUTES path is
  // always a safe non-negative integer. TRIGGER:-PT<n>M requires n be a
  // non-negative safe integer, else we'd emit -PT-10M / -PTNaNM.
  if (
    opts.reminderMinutes !== undefined &&
    !(Number.isSafeInteger(opts.reminderMinutes) && opts.reminderMinutes >= 0)
  ) {
    throw new Error(
      `reminderMinutes must be a non-negative integer: ${opts.reminderMinutes}`,
    );
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'METHOD:PUBLISH',
    'CALSCALE:GREGORIAN',
  ];

  for (const ev of events) {
    assertStructuralValue('UID', ev.uid);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${formatUtc(ev.start)}`);
    lines.push(`DTEND:${formatUtc(ev.end)}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (minutes !== undefined) {
      lines.push('BEGIN:VALARM');
      lines.push(`TRIGGER:-PT${minutes}M`);
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeText(ev.summary)}`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // Fold each logical line, join and terminate with CRLF (trailing one too).
  return lines.map(fold).join(CRLF) + CRLF;
};

/**
 * Map the app's {@link Occurrence} objects to a VCALENDAR. SUMMARY=title,
 * LOCATION=room; UID is keyed on code+start (via `opts.uidDomain`) so a repeating
 * session yields one distinct event per slot, never a single collapsed one. The
 * DESCRIPTION prepends a "Hosted by …" line when the occurrence carries `hosts`,
 * then the abstract — either alone is fine, and an occurrence with neither emits
 * no DESCRIPTION at all.
 */
export const occurrencesToIcs = (
  occurrences: Occurrence[],
  opts: IcsOptions = {},
): string => {
  const events = occurrences.map((o): IcsEvent => {
    const ev: IcsEvent = {
      uid: occurrenceUid(o.id, opts.uidDomain),
      start: o.start,
      end: o.end,
      summary: o.title,
    };
    if (o.room) ev.location = o.room;
    const descParts: string[] = [];
    if (o.hosts?.length) descParts.push(`Hosted by ${o.hosts.join(', ')}`);
    if (o.abstract) descParts.push(o.abstract);
    if (descParts.length) ev.description = descParts.join('\n\n');
    return ev;
  });
  return buildIcs(events, opts);
};

/** Test/consumer helper: decode UTF-8 bytes (non-fatal). */
export const decodeUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);
