import type { Occurrence } from '../../data/expand';
import type { OccurrenceId } from '../../data/ids';
import type { Roster } from '../crewSync';
import { crewFavPickerMembers, memberStarredIds } from '../crew-index';
import { starredOccurrences } from './filter';

/**
 * The "whose favourites" filter axis on the Schedule tab. `all` = no filter,
 * `you` = your own stars (the former favourites-only toggle), a `number` = that
 * crew member's userId (show what they starred). Pure logic + status/empty
 * copy — unit-tested; the component just renders it.
 */
export type WhoseFaves = 'all' | 'you' | number;

/** Occurrences to show for the current selection (before search narrows them). */
export function whoseFavesBase(
  occurrences: Occurrence[],
  whose: WhoseFaves,
  stars: Set<OccurrenceId>,
  roster: Roster,
): Occurrence[] {
  if (whose === 'all') return occurrences;
  if (whose === 'you') return starredOccurrences(occurrences, stars);
  const ids = memberStarredIds(roster, whose);
  return occurrences.filter((o) => ids.has(o.id));
}

/** Display name of the selected crew member, or null (not a member / ghost / gone). */
export function selectedMemberName(roster: Roster, whose: WhoseFaves): string | null {
  if (typeof whose !== 'number') return null;
  return crewFavPickerMembers(roster).find((m) => m.userId === whose)?.displayName ?? null;
}

function matchesLabel(count: number): string {
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
}

/**
 * The status line under the picker while a filter is active (whose !== 'all').
 * Names the active filter so it's clear what's narrowing the schedule.
 */
export function whoseFavesStatus(
  whose: WhoseFaves,
  memberName: string | null,
  count: number,
  searching: boolean,
  query: string,
): string {
  const matches = matchesLabel(count);
  const q = query.trim();
  if (whose === 'you') {
    return searching
      ? `Your favourites matching “${q}” · ${matches}`
      : `Showing your favourites · ${matches}`;
  }
  const poss = memberName ? `${memberName}’s` : 'their';
  return searching
    ? `${poss} favourites matching “${q}” · ${matches}`
    : `Showing ${poss} favourites · ${matches}`;
}

/** The message shown when the active filter yields zero occurrences. */
export function whoseFavesEmpty(
  whose: WhoseFaves,
  memberName: string | null,
  searching: boolean,
  query: string,
  youCount: number,
): string {
  const q = query.trim();
  if (whose === 'all') return `No sessions match “${q}”`;
  if (whose === 'you') {
    if (!searching && youCount === 0) {
      return 'No favourites yet — tap ☆ on a session to add it here.';
    }
    return searching ? `No favourites match “${q}”` : 'No favourites yet.';
  }
  const name = memberName ?? 'They';
  return searching
    ? `Nothing ${name} starred matches “${q}”`
    : `${name} hasn’t starred anything yet.`;
}
