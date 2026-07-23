import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  fold,
  unfold,
  escapeText,
  unescapeText,
  formatUtc,
  buildIcs,
  occurrencesToIcs,
  occurrenceUid,
  decodeUtf8,
  UID_DOMAIN,
  type IcsEvent,
} from './ics';
import { expandOccurrences, type RawSlot } from '../data/expand';
import { itemCode, occurrenceId } from '../data/ids';

const enc = new TextEncoder();

// A "hostile text" arbitrary: printable ASCII + multi-byte codepoints (CJK is
// 3 bytes, emoji are 4-byte / surrogate-pair sequences) — the exact inputs that
// break a character-based fold. Deliberately excludes raw CR/LF: a folded
// content line never contains them (escapeText turns newlines into `\n`), and
// their presence would collide with the CRLF+space fold marker.
const emoji = fc.constantFrom('😀', '🎉', '🦄', '💯', '🏳️‍🌈', '👨‍👩‍👧‍👦', '🇨🇦');
const cjk = fc.constantFrom('日', '本', '語', '中', '文', '한', '국', '어', '🈵');
const textUnit = fc.oneof(
  { weight: 3, arbitrary: fc.char() }, // printable ASCII 0x20–0x7e
  { weight: 1, arbitrary: emoji },
  { weight: 1, arbitrary: cjk },
);
const textArb = fc.stringOf(textUnit, { maxLength: 400 });

describe('fold / unfold — round-trip (property)', () => {
  it('unfold(fold(s)) === s for arbitrary emoji/CJK/ASCII text', () => {
    fc.assert(
      fc.property(textArb, (s) => {
        expect(unfold(fold(s))).toBe(s);
      }),
    );
  });

  it('survives a 5000-char emoji/CJK string', () => {
    const s = '😀日本語🎉'.repeat(1000); // ~5000 chars, all multi-byte
    expect(unfold(fold(s))).toBe(s);
  });
});

describe('fold — 75-octet lines, no split multi-byte sequence (property)', () => {
  it('every physical line is <= 75 octets and re-encodes without corruption', () => {
    fc.assert(
      fc.property(textArb, (s) => {
        const physical = fold(s).split('\r\n');
        for (const line of physical) {
          // (a) the octet budget is respected ...
          expect(enc.encode(line).length).toBeLessThanOrEqual(75);
          // (b) ... and no fold split a multi-byte sequence. A char-based fold
          // would cut a surrogate pair, leaving a lone surrogate; encoding then
          // decoding that yields U+FFFD, so `back !== line`. Codepoint folding
          // keeps every sequence whole, so this round-trips exactly.
          const back = new TextDecoder().decode(enc.encode(line));
          expect(back).toBe(line);
        }
        // And the whole thing still reconstructs the original.
        expect(unfold(fold(s))).toBe(s);
      }),
    );
  });

  it('folds a long emoji SUMMARY without producing U+FFFD', () => {
    const s = '🎉'.repeat(100); // 400 octets -> forced to fold many times
    const folded = fold(s);
    expect(folded).toContain('\r\n ');
    expect(folded).not.toContain('�');
    expect(unfold(folded)).toBe(s);
  });
});

describe('escapeText / unescapeText — round-trip (property)', () => {
  // Pool heavy on the RFC specials plus multi-byte text. Uses `\n` (LF) for
  // newlines — the canonical internal form escapeText round-trips exactly.
  const specialUnit = fc.oneof(
    fc.constantFrom('\\', ';', ',', '\n', ' ', ':', '"'),
    fc.char(),
    emoji,
    cjk,
  );
  const specialArb = fc.stringOf(specialUnit, { maxLength: 300 });

  it('unescapeText(escapeText(s)) === s for arbitrary \\ ; , \\n text', () => {
    fc.assert(
      fc.property(specialArb, (s) => {
        expect(unescapeText(escapeText(s))).toBe(s);
      }),
    );
  });

  it('escapes backslash FIRST (a semicolon must not double-escape)', () => {
    expect(escapeText(';')).toBe('\\;');
    expect(escapeText('\\')).toBe('\\\\');
    expect(escapeText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
    // A backslash directly before a semicolon: correct order yields \\\; ,
    // never \;  (which a backslash-last impl would emit and mis-round-trip).
    expect(escapeText('\\;')).toBe('\\\\\\;');
    expect(unescapeText('\\\\\\;')).toBe('\\;');
  });

  it('normalizes CRLF and lone CR to a literal \\n', () => {
    expect(escapeText('a\r\nb')).toBe('a\\nb');
    expect(escapeText('a\rb')).toBe('a\\nb');
    expect(escapeText('a\nb')).toBe('a\\nb');
    // Round-trips to the normalized LF form.
    expect(unescapeText(escapeText('a\r\nb'))).toBe('a\nb');
  });
});

// Build occurrences from unique (code, start) slot pairs — a pretalx submission
// has at most one slot per instant, so ids (and thus UIDs) are unique there.
const slotsArb = fc
  .uniqueArray(
    fc.tuple(
      fc.constantFrom('CZKVLN', 'ABCDEF', 'REG123', 'ZZZ999', 'HEADLS'),
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

describe('UIDs — per-occurrence, keyed on code+start (property)', () => {
  it('all UIDs are unique over an arbitrary starred set', () => {
    fc.assert(
      fc.property(slotsArb, (slots) => {
        const occ = expandOccurrences(slots);
        const uids = occ.map((o) => occurrenceUid(o.id));
        expect(new Set(uids).size).toBe(uids.length);
      }),
    );
  });

  it('a repeating item (same code, 4 distinct starts) yields 4 distinct UIDs', () => {
    // "Headless Lounge" over four con days — the collapse trap. A code-only or
    // index-only UID would fuse these; code+start keeps them separate.
    const code = itemCode('HEADLS');
    const starts = [
      '2026-07-16T22:00:00-06:00',
      '2026-07-17T22:00:00-06:00',
      '2026-07-18T22:00:00-06:00',
      '2026-07-19T22:00:00-06:00',
    ];
    const slots: RawSlot[] = starts.map((start) => ({
      code,
      title: 'Headless Lounge',
      room: 'The Vault',
      start,
      end: start,
    }));
    const occ = expandOccurrences(slots);
    const uids = occ.map((o) => occurrenceUid(o.id));
    expect(new Set(uids).size).toBe(4);

    // And the full calendar carries 4 distinct VEVENTs with those UIDs.
    const ics = occurrencesToIcs(occ, { dtstamp: '2026-07-01T00:00:00Z' });
    const uidLines = [...ics.matchAll(/^UID:(.*)$/gm)].map((m) => m[1]?.replace(/\r$/, ''));
    expect(uidLines.length).toBe(4);
    expect(new Set(uidLines).size).toBe(4);
    for (const start of starts) {
      const expected = `${occurrenceId(code, start)}@${UID_DOMAIN}`;
      expect(uidLines).toContain(expected);
    }
  });
});

describe('formatUtc — UTC Z form', () => {
  it('converts offset instants to YYYYMMDDTHHMMSSZ', () => {
    // 22:00 on the 16th at -06:00 is 04:00 UTC on the 17th.
    expect(formatUtc('2026-07-16T22:00:00-06:00')).toBe('20260717T040000Z');
    expect(formatUtc('2026-07-17T00:30:00Z')).toBe('20260717T003000Z');
  });

  it('throws on an invalid datetime', () => {
    expect(() => formatUtc('not-a-date')).toThrow();
  });

  it('rejects date-only and offset-less datetimes (timezone-dependent)', () => {
    // Date-only: no time, no zone — would be midnight in browser-local time.
    expect(() => formatUtc('2026-07-17')).toThrow();
    // Datetime with NO explicit zone — parsed against the browser's local TZ.
    expect(() => formatUtc('2026-07-17T10:00:00')).toThrow();
  });

  it('still accepts the valid zoned inputs used by the app and tests', () => {
    expect(formatUtc('2026-07-16T22:00:00-06:00')).toBe('20260717T040000Z');
    expect(formatUtc('2026-07-17T00:30:00Z')).toBe('20260717T003000Z');
    expect(formatUtc('2026-07-01T12:00:00Z')).toBe('20260701T120000Z');
  });
});

describe('assertStructuralValue — reject control chars in UID / PRODID (Fix 1)', () => {
  const evWith = (uid: string): IcsEvent => ({
    uid,
    start: '2026-07-17T18:00:00-06:00',
    end: '2026-07-17T19:00:00-06:00',
    summary: 'S',
  });
  const FIXED = '2026-07-01T12:00:00Z';

  it('throws on a UID carrying CRLF / LF / NUL (content-line injection)', () => {
    expect(() => buildIcs([evWith('A\r\nDESCRIPTION:x')], { dtstamp: FIXED })).toThrow(
      /UID/,
    );
    expect(() => buildIcs([evWith('A\nB')], { dtstamp: FIXED })).toThrow(/UID/);
    expect(() => buildIcs([evWith('A\0B')], { dtstamp: FIXED })).toThrow(/UID/);
  });

  it('throws on a PRODID carrying CRLF', () => {
    expect(() =>
      buildIcs([evWith('OK@fureh-schedules')], {
        dtstamp: FIXED,
        prodId: 'evil\r\nX-INJECT:1',
      }),
    ).toThrow(/PRODID/);
  });

  it('a clean UID / PRODID still builds', () => {
    expect(() =>
      buildIcs([evWith('OK@fureh-schedules')], { dtstamp: FIXED }),
    ).not.toThrow();
  });
});

describe('reminderMinutes guard (Fix 2)', () => {
  const FIXED = '2026-07-01T12:00:00Z';

  it('throws on negative / fractional / NaN minutes', () => {
    expect(() => buildIcs(sampleEvents(), { dtstamp: FIXED, reminderMinutes: -5 })).toThrow();
    expect(() => buildIcs(sampleEvents(), { dtstamp: FIXED, reminderMinutes: 1.5 })).toThrow();
    expect(() => buildIcs(sampleEvents(), { dtstamp: FIXED, reminderMinutes: NaN })).toThrow();
    expect(() =>
      buildIcs(sampleEvents(), { dtstamp: FIXED, reminderMinutes: Infinity }),
    ).toThrow();
  });

  it('accepts 0 minutes and the default-10 path', () => {
    const zero = buildIcs(sampleEvents(), { dtstamp: FIXED, reminderMinutes: 0 });
    expect(zero).toContain('TRIGGER:-PT0M\r\n');

    const def = buildIcs(sampleEvents(), { dtstamp: FIXED, alarm: true });
    expect(def).toContain('TRIGGER:-PT10M\r\n');
  });
});

describe('deterministic fold boundaries (Fix 4 / octet folding)', () => {
  it('a 75-octet ASCII line stays one physical line; 76 folds into two', () => {
    const at75 = fold('a'.repeat(75)).split('\r\n');
    expect(at75).toHaveLength(1);
    expect(enc.encode(at75[0]).length).toBe(75);

    const at76 = fold('a'.repeat(76)).split('\r\n');
    expect(at76).toHaveLength(2);
    expect(enc.encode(at76[0]).length).toBe(75); // first line full
    expect(enc.encode(at76[1]).length).toBe(2); // ' ' + one 'a'
  });

  it('a 4-byte emoji straddling byte 75 folds so BOTH lines are valid UTF-8', () => {
    // 74 ASCII bytes then 💯 (U+1F4AF, 4 UTF-8 bytes). A naive byte-fold at 75
    // would keep the emoji's first byte on line 1 and split the sequence.
    const s = 'a'.repeat(74) + '💯';
    const physical = fold(s).split('\r\n');
    expect(physical).toHaveLength(2);
    // Exact octet lengths: 74 ASCII, then ' ' + 4-byte emoji = 5.
    expect(enc.encode(physical[0]).length).toBe(74);
    expect(enc.encode(physical[1]).length).toBe(5);
    // Both physical lines are valid UTF-8 — no sequence was cut (no U+FFFD).
    for (const line of physical) {
      expect(new TextDecoder().decode(enc.encode(line))).toBe(line);
      expect(line).not.toContain('�');
    }
    expect(unfold(fold(s))).toBe(s);
  });
});

describe('exact per-occurrence UID strings (Fix / UID scheme)', () => {
  it('same code, two different starts => exact ${code}@${startISO}@domain UIDs', () => {
    const code = itemCode('CZKVLN');
    const s1 = '2026-07-17T18:00:00-06:00';
    const s2 = '2026-07-18T18:00:00-06:00';
    expect(occurrenceUid(occurrenceId(code, s1))).toBe(
      `CZKVLN@2026-07-17T18:00:00-06:00@${UID_DOMAIN}`,
    );
    expect(occurrenceUid(occurrenceId(code, s2))).toBe(
      `CZKVLN@2026-07-18T18:00:00-06:00@${UID_DOMAIN}`,
    );
    // Literal, hard-coded expectation (independent of UID_DOMAIN constant).
    expect(occurrenceUid(occurrenceId(code, s1))).toBe(
      'CZKVLN@2026-07-17T18:00:00-06:00@fureh-schedules',
    );
  });
});

describe('lone-surrogate TEXT (Fix 4) — deterministic U+FFFD, no throw', () => {
  it('a summary with a lone surrogate exports and round-trips through UTF-8', () => {
    const ev: IcsEvent = {
      uid: 'LONE@fureh-schedules',
      start: '2026-07-17T18:00:00-06:00',
      end: '2026-07-17T19:00:00-06:00',
      summary: 'weird \uD83D title', // lone high surrogate, no low pair
    };
    let ics = '';
    expect(() => {
      ics = buildIcs([ev], { dtstamp: '2026-07-01T12:00:00Z' });
    }).not.toThrow();
    // The emitted string equals its own UTF-8 round-trip: no hidden mismatch
    // where the file's bytes differ from the JS string (encoder would otherwise
    // substitute U+FFFD only on encode). escapeText already substituted it.
    expect(decodeUtf8(enc.encode(ics))).toBe(ics);
    // The lone surrogate itself never survives into the output.
    expect(ics).not.toContain('\uD83D');
    expect(ics).toContain('�'); // replaced with U+FFFD
  });
});

const sampleEvents = (): IcsEvent[] => [
  {
    uid: 'CZKVLN@2026-07-17T18:00:00-06:00@fureh-schedules',
    start: '2026-07-17T18:00:00-06:00',
    end: '2026-07-17T19:00:00-06:00',
    summary: 'Opening; Ceremonies, 🎉 & friends',
    location: 'Main Stage',
    description: 'Welcome to Fur-Eh!\nBring water.',
  },
  {
    uid: 'ABCDEF@2026-07-18T10:00:00-06:00@fureh-schedules',
    start: '2026-07-18T10:00:00-06:00',
    end: '2026-07-18T11:00:00-06:00',
    summary: 'Panel',
  },
];

describe('buildIcs — full calendar structure', () => {
  const FIXED = '2026-07-01T12:00:00Z';

  it('CRLF everywhere, one VCALENDAR, DTSTAMP per VEVENT, times end in Z', () => {
    const ics = buildIcs(sampleEvents(), { dtstamp: FIXED });

    // CRLF line endings only: stripping every CRLF must leave no bare CR/LF.
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);

    // Exactly one calendar wrapper.
    expect([...ics.matchAll(/^BEGIN:VCALENDAR\r$/gm)]).toHaveLength(1);
    expect([...ics.matchAll(/^END:VCALENDAR\r$/gm)]).toHaveLength(1);

    // DTSTAMP present on EVERY VEVENT.
    const vevents = [...ics.matchAll(/^BEGIN:VEVENT\r$/gm)].length;
    const dtstamps = [...ics.matchAll(/^DTSTAMP:/gm)].length;
    expect(vevents).toBe(2);
    expect(dtstamps).toBe(vevents);

    // All DTSTART/DTEND/DTSTAMP are UTC Z form.
    for (const m of ics.matchAll(/^(DTSTART|DTEND|DTSTAMP):(.*)\r$/gm)) {
      expect(m[2]).toMatch(/^\d{8}T\d{6}Z$/);
    }

    // Structural required properties.
    expect(ics).toContain('VERSION:2.0\r\n');
    expect(ics).toContain('METHOD:PUBLISH\r\n');
    expect(ics).toContain('CALSCALE:GREGORIAN\r\n');

    // Specials escaped in SUMMARY.
    expect(ics).toContain('SUMMARY:Opening\\; Ceremonies\\, 🎉 & friends\r\n');
    // Newline in DESCRIPTION escaped, not emitted raw.
    expect(ics).toContain('DESCRIPTION:Welcome to Fur-Eh!\\nBring water.\r\n');
  });

  it('VALARM present IFF opted in; OFF by default', () => {
    const noAlarm = buildIcs(sampleEvents(), { dtstamp: FIXED });
    expect(noAlarm).not.toContain('BEGIN:VALARM');

    const alarm = buildIcs(sampleEvents(), { dtstamp: FIXED, alarm: true });
    const alarmCount = [...alarm.matchAll(/^BEGIN:VALARM\r$/gm)].length;
    expect(alarmCount).toBe(2); // one per VEVENT
    expect(alarm).toContain('TRIGGER:-PT10M\r\n');
    expect(alarm).toContain('ACTION:DISPLAY\r\n');

    const custom = buildIcs(sampleEvents(), { dtstamp: FIXED, reminderMinutes: 30 });
    expect(custom).toContain('TRIGGER:-PT30M\r\n');
  });

  it('folds a long unicode SUMMARY and it unfolds back intact', () => {
    const long = '🦄 ' + '日本語のセッション '.repeat(20);
    const ics = buildIcs(
      [{ uid: 'X@fureh-schedules', start: sampleEvents()[0]!.start, end: sampleEvents()[0]!.end, summary: long }],
      { dtstamp: FIXED },
    );
    expect(ics).not.toContain('�');
    // Every physical line respects the octet budget.
    for (const line of ics.split('\r\n')) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    }
    // The SUMMARY value survives an unfold round-trip.
    const unfolded = unfold(ics);
    expect(unfolded).toContain(`SUMMARY:${escapeText(long)}`);
  });
});

describe('per-con branding — uidDomain / prodId (Tic 6)', () => {
  const FIXED = '2026-07-01T12:00:00Z';

  it('a custom uidDomain suffixes every occurrence UID', () => {
    const slots: RawSlot[] = [
      { code: '2', title: 'Fursuit Parade', room: 'Main', start: '2026-08-08T10:00:00-07:00', end: '2026-08-08T11:00:00-07:00' },
    ];
    const occ = expandOccurrences(slots, [], 'America/Vancouver');
    const ics = occurrencesToIcs(occ, { dtstamp: FIXED, uidDomain: 'tailsofsummer.com' });
    expect(ics).toContain('UID:2@2026-08-08T10:00:00-07:00@tailsofsummer.com\r\n');
    // The default fureh domain must NOT leak in.
    expect(ics).not.toContain('@fureh-schedules');
  });

  it('occurrenceUid honours an explicit domain and defaults to fureh', () => {
    const id = occurrenceId(itemCode('2'), '2026-08-08T10:00:00-07:00');
    expect(occurrenceUid(id, 'tailsofsummer.com')).toBe('2@2026-08-08T10:00:00-07:00@tailsofsummer.com');
    expect(occurrenceUid(id)).toBe(`2@2026-08-08T10:00:00-07:00@${UID_DOMAIN}`);
  });

  it('a custom prodId appears in the calendar header', () => {
    const ics = buildIcs(sampleEvents(), {
      dtstamp: FIXED,
      prodId: '-//fureh-schedules//Tails of Summer 2026 Schedule//EN',
    });
    expect(ics).toContain('PRODID:-//fureh-schedules//Tails of Summer 2026 Schedule//EN\r\n');
  });
});

describe('hosts in DESCRIPTION (Tic 6)', () => {
  const FIXED = '2026-07-01T12:00:00Z';

  it('prepends "Hosted by A, B" and keeps the abstract below it', () => {
    const slots: RawSlot[] = [
      { code: '2', title: 'Fursuit Parade', room: 'Main', start: '2026-08-08T10:00:00-07:00', end: '2026-08-08T11:00:00-07:00' },
    ];
    const talks = [
      { code: '2', abstract: 'Strut your stuff.', hosts: ['Alice', 'Bob'] },
    ];
    const occ = expandOccurrences(slots, talks, 'America/Vancouver');
    const ics = occurrencesToIcs(occ, { dtstamp: FIXED });
    // "Hosted by Alice, Bob" then the abstract, joined by an escaped blank line.
    expect(ics).toContain('DESCRIPTION:Hosted by Alice\\, Bob\\n\\nStrut your stuff.\r\n');
  });

  it('emits hosts even with no abstract, and no DESCRIPTION when neither is present', () => {
    const slots: RawSlot[] = [
      { code: '2', title: 'Parade', room: 'Main', start: '2026-08-08T10:00:00-07:00', end: '2026-08-08T11:00:00-07:00' },
      { code: '3', title: 'Plain', room: 'Hall', start: '2026-08-08T12:00:00-07:00', end: '2026-08-08T13:00:00-07:00' },
    ];
    const talks = [{ code: '2', hosts: ['Solo'] }];
    const occ = expandOccurrences(slots, talks, 'America/Vancouver');
    const ics = occurrencesToIcs(occ, { dtstamp: FIXED });
    expect(ics).toContain('DESCRIPTION:Hosted by Solo\r\n');
    // The hostless, abstractless "Plain" event has exactly one DESCRIPTION overall.
    expect([...ics.matchAll(/^DESCRIPTION:/gm)]).toHaveLength(1);
  });
});

describe('review round-2 hardening', () => {
  it('zero-pads a year below 1000 to four digits', () => {
    expect(formatUtc('0007-01-02T03:04:05Z')).toBe('00070102T030405Z');
    expect(formatUtc('0999-12-31T23:59:59Z')).toBe('09991231T235959Z');
  });

  it('rejects a UID containing an unpaired surrogate', () => {
    const start = '2026-07-17T18:00:00-06:00';
    // A lone high surrogate would encode to a hidden U+FFFD in the file bytes.
    expect(() =>
      buildIcs([{ uid: 'BAD\uD83Duid@fureh-schedules', start, end: start, summary: 'x' }]),
    ).toThrow(/surrogate/i);
  });

  it('still accepts a valid paired-surrogate emoji in a UID', () => {
    const start = '2026-07-17T18:00:00-06:00';
    // 😀 is a valid surrogate PAIR — must not trip the lone-surrogate guard.
    expect(() =>
      buildIcs([{ uid: 'OK\u{1F600}uid@fureh-schedules', start, end: start, summary: 'x' }]),
    ).not.toThrow();
  });
});
