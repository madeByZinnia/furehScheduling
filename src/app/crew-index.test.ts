import { describe, it, expect } from 'vitest';
import type { Roster } from './crewSync';
import { goingByOccurrence, crewFavPickerMembers, memberStarredIds } from './crew-index';

const roster: Roster = [
  {
    userId: 1,
    displayName: 'Alice',
    ghost: false,
    plans: [{ occurrenceId: 'a' }, { occurrenceId: 'b' }],
  },
  {
    userId: 2,
    displayName: 'Bob',
    ghost: false,
    plans: [{ occurrenceId: 'b' }],
  },
  {
    // Ghost with SMUGGLED plans — must never surface anywhere.
    userId: 3,
    displayName: 'Ghosty',
    ghost: true,
    plans: [{ occurrenceId: 'a' }, { occurrenceId: 'c' }],
  },
];

describe('goingByOccurrence', () => {
  it('maps each occurrence to the non-ghost members who starred it', () => {
    const map = goingByOccurrence(roster);
    expect(map.get('a')?.map((m) => m.displayName)).toEqual(['Alice']);
    expect(map.get('b')?.map((m) => m.displayName)).toEqual(['Alice', 'Bob']);
  });

  it('excludes ghost members entirely — even a ghost’s smuggled occurrence is absent', () => {
    const map = goingByOccurrence(roster);
    // 'c' was ONLY starred by the ghost → not in the map at all.
    expect(map.has('c')).toBe(false);
    // 'a' is Alice's only (the ghost also had 'a', but is dropped).
    expect(map.get('a')?.some((m) => m.userId === 3)).toBe(false);
  });

  it('is empty for an empty roster', () => {
    expect(goingByOccurrence([]).size).toBe(0);
  });
});

describe('crewFavPickerMembers', () => {
  it('returns non-ghost members only', () => {
    expect(crewFavPickerMembers(roster).map((m) => m.userId)).toEqual([1, 2]);
  });
});

describe('memberStarredIds', () => {
  it('returns the occurrenceIds a member starred', () => {
    expect([...memberStarredIds(roster, 1)].sort()).toEqual(['a', 'b']);
    expect([...memberStarredIds(roster, 2)]).toEqual(['b']);
  });

  it('returns empty for a ghost (privacy) or an unknown user', () => {
    expect(memberStarredIds(roster, 3).size).toBe(0); // ghost
    expect(memberStarredIds(roster, 999).size).toBe(0); // unknown
  });
});
