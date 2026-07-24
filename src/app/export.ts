/**
 * Starred-occurrences .ics export. Two concerns, kept apart on purpose:
 *
 *  - {@link buildStarredIcs} is PURE (no DOM, no I/O): it filters the schedule's
 *    occurrences down to the starred set and hands them to {@link occurrencesToIcs}.
 *    That purity is what lets the unit test hammer it deterministically.
 *  - {@link downloadIcs} is the ONLY DOM side-effect: Blob + anchor click +
 *    object-URL revoke. Nothing here talks to a server — the whole export is
 *    generated and saved client-side.
 */

import type { OccurrenceId } from '../data/ids';
import type { Occurrence } from '../data/expand';
import { occurrencesToIcs } from './ics';

export interface StarredIcsOptions {
  /** Opt in to a per-event VALARM reminder (default OFF). */
  alarm?: boolean;
  /** DTSTAMP instant (ISO) — injectable for deterministic tests. */
  dtstamp?: string;
  /** PRODID for the calendar (per-con branding). */
  prodId?: string;
  /** Domain suffix for each occurrence UID (per-con branding). */
  uidDomain?: string;
}

/**
 * The intersection of the starred set and the CURRENT schedule, in SCHEDULE
 * order (we iterate `occurrences`, not the Set, so order is stable and
 * independent of star-insertion order). Starred ids that no longer exist in
 * `occurrences` are dropped — this is the single source of truth for both the
 * exported events and the count shown in the UI, so they can never disagree.
 */
export function selectStarredOccurrences(
  stars: Set<OccurrenceId>,
  occurrences: Occurrence[],
): Occurrence[] {
  return occurrences.filter((o) => stars.has(o.id));
}

/**
 * Build a VCALENDAR of exactly the starred occurrences, in SCHEDULE order (we
 * iterate `occurrences`, not the Set, so output order is stable and independent
 * of star-insertion order). An empty star set yields a valid, empty VCALENDAR.
 */
export function buildStarredIcs(
  stars: Set<OccurrenceId>,
  occurrences: Occurrence[],
  opts: StarredIcsOptions = {},
): string {
  const selected = selectStarredOccurrences(stars, occurrences);
  const icsOpts: {
    alarm?: boolean;
    dtstamp?: string;
    prodId?: string;
    uidDomain?: string;
  } = {};
  if (opts.alarm) icsOpts.alarm = true;
  if (opts.dtstamp !== undefined) icsOpts.dtstamp = opts.dtstamp;
  if (opts.prodId !== undefined) icsOpts.prodId = opts.prodId;
  if (opts.uidDomain !== undefined) icsOpts.uidDomain = opts.uidDomain;
  return occurrencesToIcs(selected, icsOpts);
}

/**
 * Save `icsText` to the user's device as `filename`. Pure client-side: creates a
 * `text/calendar` Blob, clicks a transient `a[download]`, then revokes the object
 * URL. No network involved.
 */
export function downloadIcs(filename: string, icsText: string): void {
  const blob = new Blob([icsText], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation past the click task: revoking synchronously can cancel the
  // download in some browsers before they've read the Blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
