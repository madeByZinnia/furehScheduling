import type { Occurrence } from '../../data/expand';
import { conDay } from '../../data/expand';

/**
 * Pure schedule logic for the Schedule tab: search, day buckets, time grouping,
 * and where the "now" separator falls. No rendering, no I/O — hammered directly
 * by unit tests.
 *
 * Search covers title / abstract / track / room ONLY. There is no speaker data
 * in the feed (persons/speakers are empty), so we never pretend to search it.
 */

/** Case-insensitive substring match over the searchable fields. */
export function matchesSearch(occ: Occurrence, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    occ.title.toLowerCase().includes(q) ||
    occ.abstract.toLowerCase().includes(q) ||
    (occ.track?.toLowerCase().includes(q) ?? false) ||
    (occ.room?.toLowerCase().includes(q) ?? false)
  );
}

export function filterOccurrences(occurrences: Occurrence[], query: string): Occurrence[] {
  return query.trim() ? occurrences.filter((o) => matchesSearch(o, query)) : occurrences;
}

export interface DayTab {
  day: string; // YYYY-MM-DD (con-local)
  /** Earliest occurrence start on that day — used for weekday/label formatting. */
  startISO: string;
}

/** Distinct con-local days, ascending, each with a representative start time. */
export function dayTabs(occurrences: Occurrence[]): DayTab[] {
  const earliest = new Map<string, string>();
  for (const o of occurrences) {
    const cur = earliest.get(o.day);
    if (cur === undefined || o.start < cur) earliest.set(o.day, o.start);
  }
  return [...earliest.entries()]
    .map(([day, startISO]) => ({ day, startISO }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Index of the day tab containing `now` (else 0 before the con, last after). */
export function defaultDayIndex(tabs: DayTab[], now: Date): number {
  if (tabs.length === 0) return 0;
  const today = conDay(now.toISOString());
  const exact = tabs.findIndex((t) => t.day === today);
  if (exact !== -1) return exact;
  // Before the first day → 0; after the last → last.
  return today < tabs[0]!.day ? 0 : tabs.length - 1;
}

export interface TimeGroup {
  startISO: string;
  items: Occurrence[];
}

/** Occurrences on one day, grouped by identical start time, ascending. */
export function groupByTime(occurrences: Occurrence[], day: string): TimeGroup[] {
  const onDay = occurrences
    .filter((o) => o.day === day)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  const groups: TimeGroup[] = [];
  for (const o of onDay) {
    const last = groups[groups.length - 1];
    if (last && last.startISO === o.start) last.items.push(o);
    else groups.push({ startISO: o.start, items: [o] });
  }
  return groups;
}

/**
 * Index of the first time-group that starts strictly after `now`. The "now"
 * separator renders immediately before this index; everything before it has
 * already started. Returns groups.length when the whole day is in the past.
 */
export function nowSeparatorIndex(groups: TimeGroup[], now: Date): number {
  const t = now.getTime();
  const idx = groups.findIndex((g) => new Date(g.startISO).getTime() > t);
  return idx === -1 ? groups.length : idx;
}
