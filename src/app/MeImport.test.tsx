// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expandOccurrences, type RawSlot } from '../data/expand';
import { isStarred, starCount, __resetStars } from './stars';
import { setActiveCon } from './con';
import { CONS } from '../data/cons';
import { MeImport } from './MeImport';

const slots: RawSlot[] = [
  { code: 'OPENIN', title: 'Opening Ceremonies', room: 'Main', start: '2026-07-16T10:00:00-06:00', end: '2026-07-16T11:00:00-06:00' },
  { code: 'LOUNGE', title: 'Headless Lounge', room: 'Lounge', start: '2026-07-16T20:00:00-06:00', end: '2026-07-16T23:00:00-06:00' },
  { code: 'LOUNGE', title: 'Headless Lounge', room: 'Lounge', start: '2026-07-17T20:00:00-06:00', end: '2026-07-17T23:00:00-06:00' },
];
const occurrences = expandOccurrences(slots);

let container: HTMLElement;

beforeEach(() => {
  __resetStars();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  __resetStars();
});

const textarea = () => container.querySelector<HTMLTextAreaElement>('textarea#me-import-text');
const primaryButton = () => container.querySelector<HTMLButtonElement>('button.me-download');

describe('MeImport — paste → match → confirm → import', () => {
  const type = (value: string) => {
    void act(() => {
      const ta = textarea()!;
      ta.value = value;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const click = (el: HTMLButtonElement) => {
    void act(() => el.click());
  };

  it('walks the full flow and stars every occurrence of matched codes', () => {
    render(<MeImport occurrences={occurrences} />, container);

    // Match is disabled with empty textarea (no dead-end action).
    expect(primaryButton()!.disabled).toBe(true);

    // Paste favourites referencing both real codes plus a bogus token.
    type('["OPENIN","LOUNGE","BOGUS1"]');

    expect(primaryButton()!.disabled).toBe(false);
    click(primaryButton()!); // Match

    // Confirm summary: 3 codes found, 2 matched, both titles listed once.
    const count = container.querySelector('.me-count')!.textContent;
    expect(count).toContain('3 codes');
    expect(count).toContain('2 matched');
    const titles = [...container.querySelectorAll('.me-import-titles li')].map((li) => li.textContent);
    expect(titles).toEqual(['Opening Ceremonies', 'Headless Lounge']);

    // Nothing starred yet — confirm gates the write.
    expect(starCount()).toBe(0);

    click(primaryButton()!); // Import N sessions

    // 3 occurrences: 1 opening + 2 lounge slots (repeating session).
    expect(starCount()).toBe(3);
    expect(container.querySelector('.me-count')!.textContent).toContain('2 sessions starred');
  });

  it('shows a plain no-match message and a way back when nothing matches', () => {
    render(<MeImport occurrences={occurrences} />, container);
    type('ZZZ999 QWERTY');
    click(primaryButton()!); // Match

    expect(container.querySelector('.me-count')!.textContent).toContain('No sessions matched');
    // Start over returns to the paste step (textarea present again) — no dead-end.
    click(primaryButton()!); // Start over
    expect(textarea()).not.toBeNull();
    expect(starCount()).toBe(0);
  });
});

describe('MeImport — con-aware favourites mode', () => {
  const type = (value: string) => {
    void act(() => {
      const ta = textarea()!;
      ta.value = value;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const click = (el: HTMLButtonElement) => {
    void act(() => el.click());
  };

  // Reset the shared con singleton so later tests/files see fureh again.
  afterEach(() => setActiveCon('fureh'));

  it("Canfurence (mode:'none') renders a note and NO paste box — never a broken importer", () => {
    setActiveCon('canfurence');
    render(<MeImport occurrences={occurrences} />, container);
    // No dialect → no textarea, no Match button.
    expect(textarea()).toBeNull();
    expect(container.querySelector('button.me-download')).toBeNull();
    // A short explanatory note is shown instead.
    expect(container.querySelector('.me-note')!.textContent).toContain('no favourites to import');
  });

  it("ToS (mode:'cookie-paste') shows the console snippet hint + a paste box", () => {
    setActiveCon('tos');
    render(<MeImport occurrences={occurrences} />, container);
    const snippet = container.querySelector('.me-snippet');
    expect(snippet).not.toBeNull();
    // The exact one-liner from the con registry is surfaced verbatim.
    const tosFav = CONS.tos.favourites;
    expect(tosFav.mode).toBe('cookie-paste');
    if (tosFav.mode === 'cookie-paste') {
      expect(snippet!.textContent).toBe(tosFav.snippetHint);
    }
    expect(textarea()).not.toBeNull();
    // No pretalx "open favourites" link in cookie mode.
    expect(container.querySelector('.me-link')).toBeNull();
  });

  it('ToS: pasting the cookie value (2,3,17) stars the matching numeric-code occurrences', () => {
    setActiveCon('tos');
    // ToS-shaped schedule: numeric string codes, one repeating across two days.
    const tosSlots: RawSlot[] = [
      { code: '2', title: 'Fursuit Parade', room: 'Main', start: '2026-08-08T10:00:00-07:00', end: '2026-08-08T11:00:00-07:00' },
      { code: '2', title: 'Fursuit Parade', room: 'Main', start: '2026-08-09T10:00:00-07:00', end: '2026-08-09T11:00:00-07:00' },
      { code: '3', title: 'Dealers Den', room: 'Hall', start: '2026-08-08T12:00:00-07:00', end: '2026-08-08T13:00:00-07:00' },
      { code: '99', title: 'Not favourited', room: 'Main', start: '2026-08-08T14:00:00-07:00', end: '2026-08-08T15:00:00-07:00' },
    ];
    const tosOccs = expandOccurrences(tosSlots, [], 'America/Vancouver');
    render(<MeImport occurrences={tosOccs} />, container);

    type('2,3,17'); // 17 is unknown here; 2 (repeating) + 3 match
    click(primaryButton()!); // Match
    expect(container.querySelector('.me-count')!.textContent).toContain('2 matched');

    click(primaryButton()!); // Import
    // 2 slots for code "2" + 1 for code "3" = 3 occurrences starred.
    expect(starCount()).toBe(3);
    expect(isStarred(tosOccs[0]!.id)).toBe(true);
    expect(isStarred(tosOccs[1]!.id)).toBe(true);
    expect(isStarred(tosOccs[2]!.id)).toBe(true);
    expect(isStarred(tosOccs[3]!.id)).toBe(false); // code 99 not in the paste
  });
});
