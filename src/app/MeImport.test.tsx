// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expandOccurrences, type RawSlot } from '../data/expand';
import { starCount, __resetStars } from './stars';
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
