/**
 * Occurrence expansion — the silent bug, contained.
 *
 * A pretalx `code` identifies a *submission*, not a time slot. The feed
 * schedules a repeating session as one submission with several slots, so 208
 * slots collapse to 178 unique codes. If stars / .ics / the map key on the code
 * (or worse, on a slot index) instead of on the individual slot, four days of
 * Headless Lounge fuse into one event and a single cancellation renumbers
 * everything after it.
 *
 * Fix: expand every slot into its own Occurrence with an id keyed on
 * `code + start`, so the id is STABLE under arbitrary slot removal / reordering.
 * This module is pure (no I/O) so the property tests can hammer it directly.
 */

import { itemCode, occurrenceId, type ItemCode, type OccurrenceId } from './ids';

/** Pretalx localizes strings: `"Main Stage"` OR `{ "en": "Main Stage" }`. */
export type LocalizedString = string | Record<string, string> | null | undefined;

/** One scheduled time slot from the pretalx schedule feed. */
export interface RawSlot {
  /** Submission code, or null for the 4 code-less "Overflow Seating" entries. */
  code: string | null;
  title?: LocalizedString;
  room?: LocalizedString;
  start: string; // ISO 8601 with offset
  end: string; // ISO 8601 with offset
}

/** Submission metadata from the pretalx talks feed, joined on `code`. */
export interface RawTalk {
  code: string;
  title?: LocalizedString;
  abstract?: LocalizedString;
  track?: LocalizedString;
  /** Optional host/presenter names. Fureh's frab feed has none, so undefined there. */
  hosts?: string[];
}

/** One expanded, normalized occurrence — one row on one day at one time. */
export interface Occurrence {
  id: OccurrenceId;
  code: ItemCode;
  title: string;
  abstract: string;
  track: string | null;
  room: string | null;
  start: string;
  end: string;
  /** YYYY-MM-DD in the con's timezone, regardless of device timezone. */
  day: string;
  /** Optional host/presenter names (only present when the feed supplies them). */
  hosts?: string[];
}

export interface Schedule {
  generatedAt: string;
  occurrences: Occurrence[];
}

/** Collapse a localized string to a plain `en`-preferred string. */
export function normalizeString(value: LocalizedString): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value.en === 'string') return value.en;
  const first = Object.values(value).find((v) => typeof v === 'string');
  return first ?? '';
}

/** Fureh's timezone — the default that preserves pre-multi-con behavior. */
const CON_TZ = 'America/Edmonton';

// en-CA formats as YYYY-MM-DD. Constructing Intl.DateTimeFormat isn't free, so
// cache one formatter per timezone (built lazily on first use).
const dayFmtByTz = new Map<string, Intl.DateTimeFormat>();

function dayFormatterFor(tz: string): Intl.DateTimeFormat {
  let fmt = dayFmtByTz.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFmtByTz.set(tz, fmt);
  }
  return fmt;
}

/** Day bucket (YYYY-MM-DD) for a slot start, in the given con-local timezone. */
export function conDay(startISO: string, tz: string = CON_TZ): string {
  const d = new Date(startISO);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid start: ${startISO}`);
  return dayFormatterFor(tz).format(d);
}

/**
 * Expand slots into occurrences, enriching each with its talk metadata.
 *
 * Ids are keyed on `code + start` — never on index — so removing or reordering
 * slots leaves every surviving occurrence's id unchanged. Code-less slots get a
 * synthetic code derived from start AND room, so two code-less slots at the same
 * instant in different rooms stay distinct (and still stable across runs).
 */
export function expandOccurrences(
  slots: RawSlot[],
  talks: RawTalk[] = [],
  tz: string = CON_TZ,
): Occurrence[] {
  const byCode = new Map<string, RawTalk>();
  for (const t of talks) byCode.set(t.code, t);

  return slots.map((slot) => {
    const talk = slot.code != null ? byCode.get(slot.code) : undefined;

    const title = normalizeString(slot.title) || normalizeString(talk?.title);
    const abstract = normalizeString(talk?.abstract);
    const track = normalizeString(talk?.track) || null;
    const room = normalizeString(slot.room) || null;

    // Code-less "Overflow Seating" slots: fold room in so same-instant slots in
    // different rooms don't share an id. Stable because it derives only from
    // fields the feed already fixes (start, room), never from position.
    const code = itemCode(slot.code ?? `id:${slot.start}${room ? `#${room}` : ''}`);

    return {
      id: occurrenceId(code, slot.start),
      code,
      title,
      abstract,
      track,
      room,
      start: slot.start,
      end: slot.end,
      day: conDay(slot.start, tz),
      // exactOptionalPropertyTypes: only include hosts when the feed supplied it.
      ...(talk?.hosts !== undefined ? { hosts: talk.hosts } : {}),
    };
  });
}

/** Distinct submission codes across a set of occurrences. */
export function uniqueCodes(occurrences: Occurrence[]): Set<ItemCode> {
  return new Set(occurrences.map((o) => o.code));
}

/** Distinct con-local days, sorted ascending. */
export function uniqueDays(occurrences: Occurrence[]): string[] {
  return [...new Set(occurrences.map((o) => o.day))].sort();
}
