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

  it('defaults to the pretalx dialect (back-compat with single-con call sites)', () => {
    // No mode arg → identical to explicit 'pretalx-paste'.
    expect(parseCodes('OPENIN LOUNGE')).toEqual(parseCodes('OPENIN LOUNGE', 'pretalx-paste'));
  });
});

describe('parseCodes — cookie-paste (ToS HOWL_24) dialect', () => {
  it('extracts the numeric activity ids from a bare cookie value', () => {
    expect(parseCodes('2,3,17', 'cookie-paste')).toEqual(['2', '3', '17']);
  });

  it('dedupes and keeps first-seen order', () => {
    expect(parseCodes('2, 3, 2, 17', 'cookie-paste')).toEqual(['2', '3', '17']);
  });

  it('scopes extraction to the NAMED cookie value — no collision from the name or other cookies', () => {
    // With the cookie name, a full document.cookie string yields ONLY the
    // HOWL_24 value's ids: NOT `24` (from the name) and NOT `2026` (another
    // cookie) — either of which could be a real ToS code and get wrongly starred.
    expect(parseCodes('HOWL_24=2,3,17; year=2026; sid=99', 'cookie-paste', 'HOWL_24')).toEqual([
      '2',
      '3',
      '17',
    ]);
    // A bare value (user pasted just the value) still works with the name given.
    expect(parseCodes('2,3,17', 'cookie-paste', 'HOWL_24')).toEqual(['2', '3', '17']);
    // The name also matches mid-string (real document.cookie has leading cookies).
    expect(parseCodes('foo=1; HOWL_24=2,3,17', 'cookie-paste', 'HOWL_24')).toEqual([
      '2',
      '3',
      '17',
    ]);
  });

  it('without a cookie name, falls back to raw digit extraction (bare-value paste)', () => {
    // The default call (no name) is the "user pasted just the value" path.
    expect(parseCodes('2,3,17', 'cookie-paste')).toEqual(['2', '3', '17']);
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

describe('matchKnownCodes — ToS numeric codes (cookie-paste end to end)', () => {
  // ToS-shaped occurrences: numeric string `code`s, incl. code "2" repeating
  // across two starts (matchKnownCodes must return BOTH ids for it).
  const tosSlots: RawSlot[] = [
    { code: '2', title: 'Fursuit Parade', room: 'Main', start: '2026-08-08T10:00:00-07:00', end: '2026-08-08T11:00:00-07:00' },
    { code: '2', title: 'Fursuit Parade', room: 'Main', start: '2026-08-09T10:00:00-07:00', end: '2026-08-09T11:00:00-07:00' },
    { code: '3', title: 'Dealers Den', room: 'Hall', start: '2026-08-08T12:00:00-07:00', end: '2026-08-08T13:00:00-07:00' },
    { code: '17', title: 'Closing', room: 'Main', start: '2026-08-09T16:00:00-07:00', end: '2026-08-09T17:00:00-07:00' },
  ];
  const tosOccs = expandOccurrences(tosSlots, [], 'America/Vancouver');

  it('stars every occurrence with a matched numeric code, incl. a repeating code', () => {
    const { matched, occurrenceIds, titles } = matchKnownCodes(['2', '3'], tosOccs);
    expect(matched).toEqual(['2', '3']);
    // Code "2" repeats over two days → both ids; code "3" → one id.
    expect(occurrenceIds).toEqual([
      '2@2026-08-08T10:00:00-07:00',
      '2@2026-08-09T10:00:00-07:00',
      '3@2026-08-08T12:00:00-07:00',
    ]);
    expect(titles).toEqual(['Fursuit Parade', 'Dealers Den']);
  });

  it('parseCodes(cookie) → matchKnownCodes drops the stray cookie-name token', () => {
    // A full cookie string: the `24` from `HOWL_24` is not a real code → dropped.
    const codes = parseCodes('HOWL_24=2,17; sess=abc', 'cookie-paste');
    const { matched, unknown, occurrenceIds } = matchKnownCodes(codes, tosOccs);
    expect(matched).toEqual(['2', '17']);
    expect(unknown).toEqual(['24']);
    expect(occurrenceIds).toEqual([
      '2@2026-08-08T10:00:00-07:00',
      '2@2026-08-09T10:00:00-07:00',
      '17@2026-08-09T16:00:00-07:00',
    ]);
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
