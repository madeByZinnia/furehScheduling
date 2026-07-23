import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildDigest, escapeHtml, type DigestOccurrence } from '../../src/worker/digest';

const WINDOW = { start: '2026-07-18T13:00:00-06:00', end: '2026-07-18T14:00:00-06:00' };
const NOON_MID = new Date('2026-07-18T13:30:00-06:00'); // inside WINDOW

describe('escapeHtml', () => {
  it('escapes the three Telegram-special characters', () => {
    expect(escapeHtml('A < B & C > D')).toBe('A &lt; B &amp; C &gt; D');
  });
});

describe('buildDigest', () => {
  it('lists what is on now and what is coming up', () => {
    const occ: DigestOccurrence[] = [
      { title: 'Opening', room: 'Main Stage', start: WINDOW.start, end: WINDOW.end },
      {
        title: 'Panel',
        room: 'Banff',
        start: '2026-07-18T15:00:00-06:00',
        end: '2026-07-18T16:00:00-06:00',
      },
    ];
    const out = buildDigest(occ, NOON_MID);
    expect(out).toContain('<b>Happening now</b>');
    expect(out).toContain('Opening');
    expect(out).toContain('<b>Coming up</b>');
    expect(out).toContain('Panel');
    // The coming-up line carries a con-local time (15:00 in Edmonton).
    expect(out).toContain('15:00');
  });

  it('says nothing is on when the window is empty', () => {
    const out = buildDigest([], NOON_MID);
    expect(out).toContain('Nothing scheduled right now.');
  });

  it('excludes sessions that have already ended', () => {
    const occ: DigestOccurrence[] = [
      {
        title: 'Earlier',
        room: null,
        start: '2026-07-18T10:00:00-06:00',
        end: '2026-07-18T11:00:00-06:00',
      },
    ];
    const out = buildDigest(occ, NOON_MID);
    expect(out).not.toContain('Earlier');
  });

  it('emits only whitelisted <b>/<i> tags — dynamic text is always escaped', () => {
    const arbOcc = fc.record({
      title: fc.string(),
      room: fc.option(fc.string(), { nil: null }),
      start: fc.constant(WINDOW.start),
      end: fc.constant(WINDOW.end),
    });
    fc.assert(
      fc.property(fc.array(arbOcc, { maxLength: 6 }), (occ) => {
        const out = buildDigest(occ, NOON_MID);
        // Remove the only tags we intentionally emit, then no angle bracket may
        // remain — any survivor would be an unescaped injection.
        const stripped = out.replace(/<\/?(?:b|i)>/g, '');
        expect(stripped).not.toMatch(/[<>]/);
      }),
      { numRuns: 60 },
    );
  });
});

// An ambient venue = a block running >6h (Registration, Dealer's Den, the
// lounges). It must never lead the digest; it belongs in the "Also open" footer.
const DEALERS_DEN: DigestOccurrence = {
  title: "Dealer's Den",
  room: 'Hall',
  start: '2026-07-18T10:00:00-06:00', // open across NOON_MID (13:30)
  end: '2026-07-18T20:00:00-06:00', // 10h → ambient
};

describe('buildDigest — ambient venues', () => {
  it('keeps an ambient venue out of the headline and in the Also open footer', () => {
    const occ: DigestOccurrence[] = [
      { title: 'Opening', room: 'Main Stage', start: WINDOW.start, end: WINDOW.end },
      DEALERS_DEN,
    ];
    const out = buildDigest(occ, NOON_MID);
    expect(out).toContain('<b>Happening now</b>');
    expect(out).toContain('Opening');
    expect(out).toContain('<b>Also open</b>');
    expect(out).toContain("Dealer's Den — closes 20:00");
    // The venue appears ONLY in the footer, never before it.
    const beforeFooter = out.slice(0, out.indexOf('<b>Also open</b>'));
    expect(beforeFooter).not.toContain("Dealer's Den");
  });

  it('shows "opens HH:MM" for a venue that reopens later the same con-day', () => {
    const occ: DigestOccurrence[] = [
      {
        title: 'Headless Lounge',
        room: null,
        start: '2026-07-18T18:00:00-06:00', // opens this evening
        end: '2026-07-19T02:00:00-06:00', // 8h → ambient
      },
    ];
    const out = buildDigest(occ, NOON_MID);
    expect(out).toContain('Headless Lounge — opens 18:00');
  });

  it('shows "opens <weekday>" for a venue whose next block is a later day', () => {
    const occ: DigestOccurrence[] = [
      {
        title: 'Art Show',
        room: null,
        start: '2026-07-19T10:00:00-06:00', // Sunday (2026-07-18 is Saturday)
        end: '2026-07-19T18:00:00-06:00', // 8h → ambient
      },
    ];
    const out = buildDigest(occ, NOON_MID);
    expect(out).toContain('Art Show — opens Sun');
  });

  it('drops a venue whose every block has already ended', () => {
    const occ: DigestOccurrence[] = [
      {
        title: 'Registration',
        room: null,
        start: '2026-07-18T00:00:00-06:00',
        end: '2026-07-18T08:00:00-06:00', // 8h → ambient, but ended before 13:30
      },
    ];
    const out = buildDigest(occ, NOON_MID);
    expect(out).not.toContain('Also open');
    expect(out).not.toContain('Registration');
    expect(out).toContain('Nothing scheduled right now.');
  });

  it('shows the footer even when no panels are on now', () => {
    const out = buildDigest([DEALERS_DEN], NOON_MID);
    expect(out).toContain('Nothing scheduled right now.');
    expect(out).toContain('<b>Also open</b>');
    expect(out).toContain("Dealer's Den — closes 20:00");
  });
});

describe('buildDigest — ambient footer ordering and escaping', () => {
  it('lists open venues before upcoming ones', () => {
    const upcoming: DigestOccurrence = {
      title: 'Art Show',
      room: null,
      start: '2026-07-19T10:00:00-06:00',
      end: '2026-07-19T18:00:00-06:00',
    };
    const out = buildDigest([upcoming, DEALERS_DEN], NOON_MID);
    expect(out.indexOf("Dealer's Den — closes")).toBeLessThan(out.indexOf('Art Show — opens'));
  });

  it('escapes ambient footer text like every other dynamic field', () => {
    const arbAmbient = fc.record({
      title: fc.string(),
      room: fc.option(fc.string(), { nil: null }),
      start: fc.constant('2026-07-18T10:00:00-06:00'),
      end: fc.constant('2026-07-18T20:00:00-06:00'), // 10h → ambient, open at NOON_MID
    });
    fc.assert(
      fc.property(fc.array(arbAmbient, { maxLength: 6 }), (occ) => {
        const out = buildDigest(occ, NOON_MID);
        const stripped = out.replace(/<\/?(?:b|i)>/g, '');
        expect(stripped).not.toMatch(/[<>]/);
      }),
      { numRuns: 60 },
    );
  });
});
