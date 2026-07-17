// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Occurrence } from '../../data/expand';
import type { ItemCode, OccurrenceId } from '../../data/ids';
import { configureNow } from '../now';
import { __resetStars, toggleStar } from '../stars';
import { ScheduleView } from './ScheduleView';

function occ(p: {
  code: string;
  start: string;
  day: string;
  title: string;
  abstract?: string;
  track?: string | null;
  room?: string | null;
  end?: string;
}): Occurrence {
  return {
    id: `${p.code}@${p.start}` as OccurrenceId,
    code: p.code as ItemCode,
    title: p.title,
    abstract: p.abstract ?? '',
    track: p.track ?? null,
    room: p.room ?? null,
    start: p.start,
    end: p.end ?? p.start,
    day: p.day,
  };
}

// Three con days; "now" (set per-test) lands on the 16th between the two slots.
const A = occ({ code: 'AAA', start: '2026-07-16T10:00:00-06:00', day: '2026-07-16', title: 'Alpha' });
const B = occ({ code: 'BBB', start: '2026-07-16T12:00:00-06:00', day: '2026-07-16', title: 'Beta' });
const C = occ({ code: 'CCC', start: '2026-07-17T10:00:00-06:00', day: '2026-07-17', title: 'Gamma' });
const D = occ({ code: 'DDD', start: '2026-07-18T10:00:00-06:00', day: '2026-07-18', title: 'Delta' });
const OCCS = [A, B, C, D];

let container: HTMLElement;

beforeEach(() => {
  __resetStars();
  configureNow('?now=2026-07-16T11:00:00-06:00'); // a con day, between Alpha and Beta
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  configureNow(''); // clear the time-travel override
  __resetStars();
});

const titles = () =>
  Array.from(container.querySelectorAll<HTMLElement>('.event-row .title')).map(
    (n) => n.textContent,
  );
const mount = () =>
  void act(() => {
    render(<ScheduleView occurrences={OCCS} />, container);
  });
const clickFaves = () =>
  void act(() => {
    container
      .querySelector<HTMLButtonElement>('.faves-toggle')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const setQuery = (value: string) =>
  void act(() => {
    const input = container.querySelector<HTMLInputElement>('input.search')!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('ScheduleView — favourites-only filter', () => {
  it('toggles the pill and shows only starred sessions across all days', () => {
    toggleStar(A.id); // day 16
    toggleStar(C.id); // day 17 — proves the filter spans days, not just the active tab
    mount();

    const pill = container.querySelector<HTMLButtonElement>('.faves-toggle')!;
    expect(pill.getAttribute('aria-pressed')).toBe('false');

    clickFaves();

    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual(['Alpha', 'Gamma']); // Beta/Delta (unstarred) hidden
    expect(container.querySelectorAll('.result-day')).toHaveLength(2); // grouped by day
    expect(container.querySelector('.filter-status')!.textContent).toBe('Showing favourites · 2 matches');
  });

  it('search narrows within favourites (the two filters compose)', () => {
    toggleStar(A.id);
    toggleStar(C.id);
    mount();
    clickFaves();

    setQuery('Gamma');

    expect(titles()).toEqual(['Gamma']); // starred AND matches query
    expect(container.querySelector('.filter-status')!.textContent).toBe(
      'Favourites matching “Gamma” · 1 match',
    );
  });

  it('shows an actionable empty state when nothing is starred', () => {
    mount();
    clickFaves();
    expect(titles()).toEqual([]);
    expect(container.querySelector('.results-summary')!.textContent).toContain('No favourites yet');
  });
});

describe('ScheduleView — now separator in search results', () => {
  it('renders the now divider inside search results on today’s section', () => {
    mount();
    setQuery('a'); // matches Alpha/Beta/Gamma/Delta — spans all days incl. today
    // The separator only renders on today's (16th) section; before this feature
    // search mode had none.
    expect(container.querySelector('.now-sep')).not.toBeNull();
  });
});

describe('ScheduleView — jump-to-now FAB', () => {
  it('shows the FAB on a con day, scrolls the now separator in, and moves focus to it', () => {
    let scrolled = 0;
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {
      scrolled++;
    };
    mount();

    const fab = container.querySelector<HTMLButtonElement>('.fab');
    expect(fab).not.toBeNull();
    expect(fab!.textContent.trim()).toBe('Jump to now'); // visible label = accessible name

    void act(() => {
      fab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(scrolled).toBeGreaterThan(0);
    // Focus lands on the now separator so keyboard/AT users are taken there.
    const nowSep = container.querySelector('.now-sep');
    expect(nowSep).not.toBeNull();
    expect(document.activeElement).toBe(nowSep);
  });

  it('hides the FAB when today is outside the con', () => {
    configureNow('?now=2026-08-01T11:00:00-06:00'); // after the con
    mount();
    expect(container.querySelector('.fab')).toBeNull();
  });

  it('hides the FAB when a filter is active but today has no matching sessions', () => {
    // Star only a non-today (Friday) session, then filter to favourites: today
    // (Saturday) has no now separator on screen, so the FAB would be inert.
    toggleStar(C.id);
    mount();
    expect(container.querySelector('.fab')).not.toBeNull(); // browse mode: shown
    clickFaves();
    expect(container.querySelector('.fab')).toBeNull(); // faves excludes today → hidden
  });
});
