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
