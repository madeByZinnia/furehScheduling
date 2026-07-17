import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OccurrenceId } from '../data/ids';
import { expandOccurrences, type RawSlot } from '../data/expand';
import { UID_DOMAIN } from './ics';
import { buildStarredIcs, downloadIcs, selectStarredOccurrences } from './export';

// A fixed DTSTAMP so every assertion below is deterministic across machines/tz.
const DTSTAMP = '2026-07-01T00:00:00Z';

// Three occurrences across two submissions; the middle one is left UNstarred so
// we can prove the filter excludes non-starred slots.
const slots: RawSlot[] = [
  { code: 'AAA', title: 'Opening', room: 'Main Stage', start: '2026-07-16T10:00:00-06:00', end: '2026-07-16T11:00:00-06:00' },
  { code: 'BBB', title: 'Panel', room: 'Room 2', start: '2026-07-16T12:00:00-06:00', end: '2026-07-16T13:00:00-06:00' },
  { code: 'AAA', title: 'Opening (day 2)', room: 'Main Stage', start: '2026-07-17T10:00:00-06:00', end: '2026-07-17T11:00:00-06:00' },
];
const occurrences = expandOccurrences(slots);
const first = occurrences[0]!;
const middle = occurrences[1]!;
const third = occurrences[2]!;

const count = (ics: string, marker: string): number =>
  ics.split(marker).length - 1;

describe('buildStarredIcs — exactly the starred occurrences', () => {
  it('emits only starred events, in schedule order, excluding non-starred', () => {
    // Star the first and third; deliberately NOT the middle (BBB).
    const stars = new Set<OccurrenceId>([first.id, third.id]);
    const ics = buildStarredIcs(stars, occurrences, { dtstamp: DTSTAMP });

    // Exactly two VEVENTs / two UIDs == the starred count.
    expect(count(ics, 'BEGIN:VEVENT')).toBe(stars.size);
    expect(count(ics, 'UID:')).toBe(stars.size);

    // The two starred UIDs are present ...
    expect(ics).toContain(`UID:${first.id}@${UID_DOMAIN}`);
    expect(ics).toContain(`UID:${third.id}@${UID_DOMAIN}`);
    // ... and the non-starred one is absent.
    expect(ics).not.toContain(`UID:${middle.id}@${UID_DOMAIN}`);
    expect(ics).not.toContain('Panel');

    // Schedule order is preserved (first appears before third).
    expect(ics.indexOf(first.id)).toBeLessThan(ics.indexOf(third.id));
  });

  it('adds a VALARM per event iff { alarm: true }, default OFF', () => {
    const stars = new Set<OccurrenceId>([first.id, third.id]);

    const withAlarm = buildStarredIcs(stars, occurrences, { alarm: true, dtstamp: DTSTAMP });
    expect(count(withAlarm, 'BEGIN:VALARM')).toBe(2);
    expect(withAlarm).toContain('TRIGGER:-PT10M');

    const noAlarm = buildStarredIcs(stars, occurrences, { dtstamp: DTSTAMP });
    expect(noAlarm).not.toContain('BEGIN:VALARM');

    // Default (no opts) is also alarm-OFF.
    const bare = buildStarredIcs(stars, occurrences);
    expect(bare).not.toContain('BEGIN:VALARM');
  });

  it('empty stars → a valid VCALENDAR with zero VEVENTs', () => {
    const ics = buildStarredIcs(new Set<OccurrenceId>(), occurrences, { dtstamp: DTSTAMP });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(count(ics, 'BEGIN:VEVENT')).toBe(0);
  });
});

describe('selectStarredOccurrences — intersection with the current schedule', () => {
  it('drops starred ids that are not present in occurrences', () => {
    // stars {A, GHOST}, occurrences [A, B]  →  [A] only.
    const ghost = 'ghost@nowhere' as OccurrenceId;
    const stars = new Set<OccurrenceId>([first.id, ghost]);
    const result = selectStarredOccurrences(stars, [first, middle]);

    expect(result).toEqual([first]);
    expect(result.map((o) => o.id)).not.toContain(ghost);
    // The unstarred real occurrence (middle/B) is also excluded.
    expect(result).not.toContain(middle);
  });

  it('preserves schedule order regardless of star-insertion order', () => {
    // Insert third BEFORE first; output must still follow schedule order.
    const stars = new Set<OccurrenceId>([third.id, first.id]);
    const result = selectStarredOccurrences(stars, occurrences);
    expect(result).toEqual([first, third]);
  });
});

describe('downloadIcs — the only DOM side-effect', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let clicked: HTMLAnchorElement[];
  let createdBlobs: Blob[];

  beforeEach(() => {
    vi.useFakeTimers();
    createdBlobs = [];
    clicked = [];

    createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return 'blob:mock-url';
    });
    revokeObjectURL = vi.fn();
    // happy-dom does not implement object URLs; provide them.
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    // Capture the anchor at click time (jsdom/happy-dom won't navigate).
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this);
      });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.useRealTimers();
  });

  it('creates a text/calendar Blob, clicks an a[download] with the filename, and revokes (deferred)', async () => {
    downloadIcs('fureh-2026.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');

    // A single text/calendar Blob was created and passed to createObjectURL.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0]!.type).toBe('text/calendar');

    // An anchor with the download filename and the object URL was clicked ...
    expect(clicked).toHaveLength(1);
    const a = clicked[0]!;
    expect(a.getAttribute('download')).toBe('fureh-2026.ics');
    expect(a.href).toContain('blob:mock-url');
    // ... and removed from the DOM afterwards.
    expect(document.body.contains(a)).toBe(false);

    // Revocation is DEFERRED — not called synchronously with the click.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Flush the setTimeout(0); now it revokes exactly the URL we handed out.
    await vi.runAllTimersAsync();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
