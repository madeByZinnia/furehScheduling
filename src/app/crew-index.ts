import type { Roster } from './crewSync';

/**
 * Pure roster derivations for the Schedule "also going" row and the
 * "whose favourites" picker. No I/O, no rendering — unit-tested directly.
 *
 * Privacy invariant: ghost members are excluded from EVERY derivation here. A
 * ghost's plans are already redacted server-side to `[]`, but we also drop the
 * member outright so a stray payload can never surface a ghost's stars, and so
 * you can never navigate to a ghost's favourites.
 */

export interface CrewMember {
  userId: number;
  displayName: string;
}

/**
 * Map each occurrenceId → the non-ghost crew members who starred it. Used to
 * render the "also going" chips on a schedule card. Members appear in roster
 * order; an occurrence nobody starred is simply absent from the map.
 */
export function goingByOccurrence(roster: Roster): Map<string, CrewMember[]> {
  const byOcc = new Map<string, CrewMember[]>();
  for (const member of roster) {
    if (member.ghost) continue;
    for (const plan of member.plans) {
      const entry: CrewMember = { userId: member.userId, displayName: member.displayName };
      const existing = byOcc.get(plan.occurrenceId);
      if (existing) existing.push(entry);
      else byOcc.set(plan.occurrenceId, [entry]);
    }
  }
  return byOcc;
}

/**
 * The non-ghost members offered by the "whose favourites" picker. You can't
 * navigate a ghost's stars (they're hidden), so ghosts never appear as options.
 */
export function crewFavPickerMembers(roster: Roster): CrewMember[] {
  return roster
    .filter((member) => !member.ghost)
    .map((member) => ({ userId: member.userId, displayName: member.displayName }));
}

/**
 * The occurrenceIds a given member has starred — the filter set for
 * "showing <member>'s favourites". Empty for an unknown id or a ghost (privacy).
 */
export function memberStarredIds(roster: Roster, userId: number): Set<string> {
  const member = roster.find((entry) => entry.userId === userId);
  if (!member || member.ghost) return new Set();
  return new Set(member.plans.map((plan) => plan.occurrenceId));
}
