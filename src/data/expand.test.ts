import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  expandOccurrences,
  normalizeString,
  conDay,
  uniqueCodes,
  type RawSlot,
  type RawTalk,
} from './expand';

// A slot arbitrary with UNIQUE (code, start) pairs — a pretalx submission has at
// most one slot at any given instant, so distinct ids are guaranteed there.
const slotsArb = fc
  .uniqueArray(
    fc.tuple(
      fc.option(fc.constantFrom('CZKVLN', 'ABCDEF', 'REG123', 'ZZZ999'), { nil: null }),
      // start epochs across the con window (2026-07-16..19, con-local)
      fc.integer({
        min: Date.parse('2026-07-16T00:00:00-06:00'),
        max: Date.parse('2026-07-19T23:00:00-06:00'),
      }),
    ),
    { selector: ([code, start]) => `${code}@${start}`, minLength: 1, maxLength: 60 },
  )
  .map((pairs): RawSlot[] =>
    pairs.map(([code, epoch]) => {
      const start = new Date(epoch).toISOString();
      return { code, title: 'T', room: 'Main Stage', start, end: start };
    }),
  );

// Remove/reorder an arbitrary subset, deterministically from a seed.
function permuteAndDrop<T>(items: T[], seed: number): T[] {
  const arr = items.map((v, i) => ({ v, k: (i * 2654435761 + seed) >>> 0 }));
  arr.sort((a, b) => a.k - b.k); // reorder
  return arr.filter((_, i) => (i * 7 + seed) % 3 !== 0).map((x) => x.v); // drop ~1/3
}

describe('expandOccurrences — occurrence-id stability (property)', () => {
  it('every surviving occurrence keeps its id under arbitrary removal/reorder', () => {
    fc.assert(
      fc.property(slotsArb, fc.integer(), (slots, seed) => {
        const full = expandOccurrences(slots);
        const idFor = new Map(full.map((o) => [`${o.code}@${o.start}`, o.id]));

        const survivors = expandOccurrences(permuteAndDrop(slots, seed));
        for (const o of survivors) {
          expect(o.id).toBe(idFor.get(`${o.code}@${o.start}`));
        }
      }),
    );
  });

  it('id depends only on code+start, never on position', () => {
    fc.assert(
      fc.property(slotsArb, (slots) => {
        const a = expandOccurrences(slots);
        const b = expandOccurrences([...slots].reverse());
        const byKey = (o: { code: string; start: string; id: string }) =>
          [`${o.code}@${o.start}`, o.id] as const;
        expect(new Map(b.map(byKey))).toEqual(new Map(a.map(byKey)));
      }),
    );
  });
});

describe('expandOccurrences — expansion counts (property)', () => {
  it('one occurrence per slot; per-code count == slots with that code', () => {
    fc.assert(
      fc.property(slotsArb, (slots) => {
        const occ = expandOccurrences(slots);
        expect(occ.length).toBe(slots.length);
        // Mirror production exactly: the synthetic code uses the NORMALIZED room.
        const syntheticCode = (s: RawSlot) => {
          const room = normalizeString(s.room);
          return s.code ?? `id:${s.start}${room ? `#${room}` : ''}`;
        };
        for (const code of uniqueCodes(occ)) {
          const fromSlots = slots.filter((s) => syntheticCode(s) === code).length;
          expect(occ.filter((o) => o.code === code).length).toBe(fromSlots);
        }
      }),
    );
  });

  it('code-less slots get distinct, stable synthetic ids', () => {
    const slots: RawSlot[] = [
      {
        code: null,
        title: 'Overflow',
        start: '2026-07-17T10:00:00-06:00',
        end: '2026-07-17T11:00:00-06:00',
      },
      {
        code: null,
        title: 'Overflow',
        start: '2026-07-18T10:00:00-06:00',
        end: '2026-07-18T11:00:00-06:00',
      },
    ];
    const a = expandOccurrences(slots);
    const b = expandOccurrences([...slots].reverse());
    expect(new Set(a.map((o) => o.id)).size).toBe(2);
    expect(new Map(a.map((o) => [o.start, o.id]))).toEqual(new Map(b.map((o) => [o.start, o.id])));
  });

  it('two code-less slots at the same instant in different rooms do not collide', () => {
    const slots: RawSlot[] = [
      {
        code: null,
        title: 'Overflow',
        room: 'Wyndham - Gallery 1',
        start: '2026-07-17T10:00:00-06:00',
        end: '2026-07-17T11:00:00-06:00',
      },
      {
        code: null,
        title: 'Overflow',
        room: 'Delta - Gallery 2',
        start: '2026-07-17T10:00:00-06:00',
        end: '2026-07-17T11:00:00-06:00',
      },
    ];
    const occ = expandOccurrences(slots);
    expect(new Set(occ.map((o) => o.id)).size).toBe(2);
    // ...and still stable across a reorder.
    const reversed = expandOccurrences([...slots].reverse());
    expect(new Map(occ.map((o) => [o.room, o.id]))).toEqual(
      new Map(reversed.map((o) => [o.room, o.id])),
    );
  });
});

describe('normalizeString', () => {
  it('handles plain strings, {en}, other langs, and null', () => {
    expect(normalizeString('Main Stage')).toBe('Main Stage');
    expect(normalizeString({ en: 'Main Stage', fr: 'Scène' })).toBe('Main Stage');
    expect(normalizeString({ fr: 'Scène' })).toBe('Scène');
    expect(normalizeString(null)).toBe('');
    expect(normalizeString(undefined)).toBe('');
  });
});

describe('conDay — America/Edmonton bucketing', () => {
  it('groups by con-local day regardless of the offset in the timestamp', () => {
    // 00:30 UTC on the 17th is still the 16th in Edmonton (UTC-6).
    expect(conDay('2026-07-17T00:30:00Z')).toBe('2026-07-16');
    expect(conDay('2026-07-16T10:00:00-06:00')).toBe('2026-07-16');
  });

  it('defaults to America/Edmonton when no tz is passed', () => {
    expect(conDay('2026-07-17T00:30:00Z')).toBe(conDay('2026-07-17T00:30:00Z', 'America/Edmonton'));
  });

  it('throws on an unparseable start (guard fires before the formatter)', () => {
    expect(() => conDay('not-a-date')).toThrow(/invalid start/i);
    expect(() => conDay('not-a-date', 'America/Toronto')).toThrow(/invalid start/i);
  });
});

describe('conDay / expandOccurrences — timezone parameterization is real', () => {
  // 00:30 Eastern on Aug 8 = 04:30 UTC. Toronto (UTC-4) is still Aug 8, but
  // Edmonton (UTC-6) has rolled back to 22:30 on Aug 7. A hardcoded-Edmonton
  // implementation cannot produce the Toronto date and thus fails this.
  const start = '2026-08-08T00:30:00-04:00';

  it('buckets the same instant to different calendar days by tz', () => {
    expect(conDay(start, 'America/Toronto')).toBe('2026-08-08');
    expect(conDay(start, 'America/Edmonton')).toBe('2026-08-07');
    expect(conDay(start, 'America/Toronto')).not.toBe(conDay(start, 'America/Edmonton'));
  });

  it('expandOccurrences honours the tz argument for the day bucket', () => {
    const slot: RawSlot = { code: 'CZKVLN', title: 'T', room: 'Main', start, end: start };
    expect(expandOccurrences([slot], [], 'America/Toronto')[0]!.day).toBe('2026-08-08');
    expect(expandOccurrences([slot], [], 'America/Edmonton')[0]!.day).toBe('2026-08-07');
    // Default (no tz) preserves Edmonton behavior.
    expect(expandOccurrences([slot])[0]!.day).toBe('2026-08-07');
  });
});

describe('expandOccurrences — hosts round-trip', () => {
  const slot: RawSlot = {
    code: 'CZKVLN',
    title: 'T',
    room: 'Main',
    start: '2026-07-17T10:00:00-06:00',
    end: '2026-07-17T11:00:00-06:00',
  };

  it('carries hosts from the joined talk onto the occurrence', () => {
    const talk: RawTalk = { code: 'CZKVLN', hosts: ['A', 'B'] };
    const occ = expandOccurrences([slot], [talk]);
    expect(occ[0]!.hosts).toEqual(['A', 'B']);
  });

  it('leaves hosts undefined when the talk supplies none (no `hosts` key emitted)', () => {
    const talk: RawTalk = { code: 'CZKVLN' };
    const occ = expandOccurrences([slot], [talk]);
    expect(occ[0]!.hosts).toBeUndefined();
    expect('hosts' in occ[0]!).toBe(false);
  });
});
