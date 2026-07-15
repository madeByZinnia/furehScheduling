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
  /** YYYY-MM-DD in America/Edmonton, regardless of device timezone. */
  day: string;
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

const CON_TZ = 'America/Edmonton';
// en-CA formats as YYYY-MM-DD; América/Edmonton has no DST shift during the con.
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CON_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Day bucket (YYYY-MM-DD) for a slot start, in con-local time. */
export function conDay(startISO: string): string {
  const d = new Date(startISO);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid start: ${startISO}`);
  return dayFormatter.format(d);
}

/**
 * Expand slots into occurrences, enriching each with its talk metadata.
 *
 * Ids are keyed on `code + start` — never on index — so removing or reordering
 * slots leaves every surviving occurrence's id unchanged. Code-less slots get a
 * synthetic, start-derived code so they too are stable and distinct.
 */
export function expandOccurrences(slots: RawSlot[], talks: RawTalk[] = []): Occurrence[] {
  const byCode = new Map<string, RawTalk>();
  for (const t of talks) byCode.set(t.code, t);

  return slots.map((slot) => {
    const rawCode = slot.code ?? `id:${slot.start}`;
    const code = itemCode(rawCode);
    const talk = slot.code != null ? byCode.get(slot.code) : undefined;

    const title = normalizeString(slot.title) || normalizeString(talk?.title);
    const abstract = normalizeString(talk?.abstract);
    const track = normalizeString(talk?.track) || null;
    const room = normalizeString(slot.room) || null;

    return {
      id: occurrenceId(code, slot.start),
      code,
      title,
      abstract,
      track,
      room,
      start: slot.start,
      end: slot.end,
      day: conDay(slot.start),
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
