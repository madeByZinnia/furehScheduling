import { describe, it, expect, beforeEach } from 'vitest';
import { expandOccurrences, type RawSlot } from '../data/expand';
import type { OccurrenceId } from '../data/ids';
import { parseCodes, matchKnownCodes } from './import';
import { addStars, isStarred, starCount, __resetStars } from './stars';

// A tiny schedule with a REPEATING code (LOUNGE runs twice → 2 occurrences),
// a single-slot code (OPENIN), and a code-less "other" entry.
const slots: RawSlot[] = [
  { code: 'OPENIN', title: 'Opening Ceremonies', room: 'Main', start: '2026-07-16T10:00:00-06:00', end: '2026-07-16T11:00:00-06:00' },
  { code: 'LOUNGE', title: 'Headless Lounge', room: 'Lounge', start: '2026-07-16T20:00:00-06:00', end: '2026-07-16T23:00:00-06:00' },
  { code: 'LOUNGE', title: 'Headless Lounge', room: 'Lounge', start: '2026-07-17T20:00:00-06:00', end: '2026-07-17T23:00:00-06:00' },
  { code: null, title: 'Overflow Seating', room: 'Hall', start: '2026-07-16T09:00:00-06:00', end: '2026-07-16T10:00:00-06:00' },
];
const occurrences = expandOccurrences(slots);

describe('parseCodes', () => {
  it('extracts codes from a realistic pasted favourites JSON blob, deduped, first-seen order', () => {
    const paste = JSON.stringify({
      talks: ['OPENIN', 'LOUNGE', 'OPENIN', 'ZZZ999'],
    });
    expect(parseCodes(paste)).toEqual(['OPENIN', 'LOUNGE', 'ZZZ999']);
  });

  it('ignores lowercase, too-short, and too-long alphanumeric tokens', () => {
    // lowercase abcdef (ignored), ABC (too short), ABCDEFG (7 chars, no \b match),
    // 12345 (too short), ABC123 (valid).
    expect(parseCodes('abcdef ABC ABCDEFG 12345 ABC123')).toEqual(['ABC123']);
  });

  it('over-matching arbitrary 6-char tokens is harmless — they are just returned', () => {
    // A random 6-char token is extracted; intersection (below) drops it.
    expect(parseCodes('noise QWERTY more')).toEqual(['QWERTY']);
  });
});

describe('matchKnownCodes', () => {
  it('separates known codes from unknown tokens and stars ALL occurrences per matched code', () => {
    // A favourites paste referencing a matched code (LOUNGE, repeating) plus an
    // unknown bogus 6-char token.
    const codes = parseCodes('["LOUNGE","BOGUS1"]');
    const { matched, unknown, occurrenceIds, titles } = matchKnownCodes(codes, occurrences);

    expect(matched).toEqual(['LOUNGE']);
    expect(unknown).toEqual(['BOGUS1']); // dropped, harmless
    // The repeating LOUNGE has 2 occurrences → BOTH ids are starred.
    expect(occurrenceIds).toHaveLength(2);
    expect(occurrenceIds).toEqual([
      'LOUNGE@2026-07-16T20:00:00-06:00',
      'LOUNGE@2026-07-17T20:00:00-06:00',
    ]);
    // The session title appears once, not per occurrence.
    expect(titles).toEqual(['Headless Lounge']);
  });

  it('matches a single-slot code to exactly one occurrence', () => {
    const { matched, occurrenceIds, titles } = matchKnownCodes(['OPENIN'], occurrences);
    expect(matched).toEqual(['OPENIN']);
    expect(occurrenceIds).toEqual(['OPENIN@2026-07-16T10:00:00-06:00']);
    expect(titles).toEqual(['Opening Ceremonies']);
  });

  it('is deterministic and drops everything when no code is known', () => {
    const { matched, unknown, occurrenceIds } = matchKnownCodes(['ZZZ999', 'QWERTY'], occurrences);
    expect(matched).toEqual([]);
    expect(unknown).toEqual(['ZZZ999', 'QWERTY']);
    expect(occurrenceIds).toEqual([]);
  });
});

describe('addStars — bulk union integration', () => {
  beforeEach(() => __resetStars());

  it('unions matched occurrence ids into the stars set', () => {
    const { occurrenceIds } = matchKnownCodes(parseCodes('LOUNGE OPENIN'), occurrences);
    addStars(occurrenceIds);
    expect(starCount()).toBe(3); // 2 lounge slots + 1 opening
    for (const id of occurrenceIds) expect(isStarred(id)).toBe(true);
  });

  it('dedupes — re-importing an already-starred id is a no-op, and a second import merges', () => {
    const first = matchKnownCodes(['LOUNGE'], occurrences).occurrenceIds;
    addStars(first);
    expect(starCount()).toBe(2);
    // Re-add the same ids → no change.
    addStars(first);
    expect(starCount()).toBe(2);
    // A second import of a different code merges in.
    const second = matchKnownCodes(['OPENIN'], occurrences).occurrenceIds;
    addStars(second);
    expect(starCount()).toBe(3);
  });

  it('merges with an existing manual star', () => {
    const manual = 'OPENIN@2026-07-16T10:00:00-06:00' as OccurrenceId;
    addStars([manual]);
    // Import a paste that includes the manual one (via OPENIN) plus LOUNGE.
    const { occurrenceIds } = matchKnownCodes(parseCodes('OPENIN LOUNGE'), occurrences);
    addStars(occurrenceIds);
    expect(starCount()).toBe(3); // manual OPENIN not double-counted
  });
});
