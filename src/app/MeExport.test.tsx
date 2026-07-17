// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import type { OccurrenceId } from '../data/ids';
import { expandOccurrences, type RawSlot } from '../data/expand';
import { toggleStar, __resetStars } from './stars';
import { MeExport } from './MeExport';

// A tiny fixed schedule; the middle slot stays unstarred in most cases.
const slots: RawSlot[] = [
  { code: 'AAA', title: 'Opening', room: 'Main Stage', start: '2026-07-16T10:00:00-06:00', end: '2026-07-16T11:00:00-06:00' },
  { code: 'BBB', title: 'Panel', room: 'Room 2', start: '2026-07-16T12:00:00-06:00', end: '2026-07-16T13:00:00-06:00' },
];
const occurrences = expandOccurrences(slots);
const real = occurrences[0]!;
const GHOST = 'ghost@nowhere' as OccurrenceId;

let container: HTMLElement;

beforeEach(() => {
  __resetStars();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container); // unmount
  container.remove();
  __resetStars();
});

const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]');
const button = () => container.querySelector<HTMLButtonElement>('button.me-download');

describe('MeExport — cognitive-a11y wiring', () => {
  it('reminder checkbox is UNCHECKED by default', () => {
    toggleStar(real.id); // a real star so the control isn't disabled-by-emptiness
    render(<MeExport occurrences={occurrences} />, container);
    const cb = checkbox();
    expect(cb).not.toBeNull();
    expect(cb!.checked).toBe(false);
  });

  it('button is DISABLED when the star∩schedule intersection is empty (ghost-only star)', () => {
    // A star that no longer exists in the schedule must not enable Download.
    toggleStar(GHOST);
    render(<MeExport occurrences={occurrences} />, container);
    expect(button()!.disabled).toBe(true);
    // Count is driven by the intersection, not stars.size → shows 0.
    expect(container.querySelector('.me-count')!.textContent).toContain('0 sessions');
    // No-dead-end hint is shown.
    expect(container.querySelector('.me-hint')).not.toBeNull();
  });

  it('button is ENABLED when a real star exists, and count reflects the intersection', () => {
    toggleStar(real.id);
    render(<MeExport occurrences={occurrences} />, container);
    expect(button()!.disabled).toBe(false);
    expect(container.querySelector('.me-count')!.textContent).toContain('1 session starred');
    expect(container.querySelector('.me-hint')).toBeNull();
  });

  it('a ghost star does not inflate the count past the real starred occurrences', () => {
    toggleStar(real.id);
    toggleStar(GHOST); // stars.size === 2, but only 1 is in the schedule
    render(<MeExport occurrences={occurrences} />, container);
    expect(container.querySelector('.me-count')!.textContent).toContain('1 session starred');
    expect(button()!.disabled).toBe(false);
  });
});
