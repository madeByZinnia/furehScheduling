// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Occurrence } from '../../data/expand';
import type { ItemCode, OccurrenceId } from '../../data/ids';
import type { TelegramSession } from '../telegram-session';
import type { Roster, RosterResult } from '../crewSync';
import { configureNow } from '../now';
import { __resetStars, toggleStar } from '../stars';
import { __setCrewLoader, __resetCrew } from '../crew';
import { ScheduleView } from './ScheduleView';

// Mutable mocked session so a test can become "self" (default: plain web).
const sessionRef = vi.hoisted(() => {
  const current: TelegramSession = {
    initData: null,
    startParam: null,
    user: null,
    authDate: null,
    isTelegram: false,
  };
  return { current };
});
vi.mock('../telegram-session', () => ({ getTelegramSession: () => sessionRef.current }));

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

const A = occ({ code: 'AAA', start: '2026-07-16T10:00:00-06:00', day: '2026-07-16', title: 'Alpha' });
const B = occ({ code: 'BBB', start: '2026-07-16T12:00:00-06:00', day: '2026-07-16', title: 'Beta' });
const C = occ({ code: 'CCC', start: '2026-07-17T10:00:00-06:00', day: '2026-07-17', title: 'Gamma' });
const D = occ({ code: 'DDD', start: '2026-07-18T10:00:00-06:00', day: '2026-07-18', title: 'Delta' });
const OCCS = [A, B, C, D];

let container: HTMLElement;

beforeEach(() => {
  __resetStars();
  __resetCrew();
  // Default: plain web (no crew) — the favourites/FAB tests want an empty roster.
  __setCrewLoader(() => Promise.resolve({ kind: 'non-telegram' }));
  sessionRef.current = {
    initData: null,
    startParam: null,
    user: null,
    authDate: null,
    isTelegram: false,
  };
  configureNow('?now=2026-07-16T11:00:00-06:00'); // a con day, between Alpha and Beta
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  configureNow('');
  __resetStars();
  __resetCrew();
});

const titles = () =>
  Array.from(container.querySelectorAll<HTMLElement>('.event-row .title')).map((n) => n.textContent);

const rowByTitle = (t: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('.event-row')).find(
    (r) => r.querySelector('.title')?.textContent === t,
  );

/** Render and flush the crew store's async load so roster-dependent UI settles. */
async function mount(occs: Occurrence[] = OCCS): Promise<void> {
  await act(async () => {
    render(<ScheduleView occurrences={occs} />, container);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function mountWithCrew(roster: Roster, occs: Occurrence[] = OCCS): Promise<void> {
  __setCrewLoader((): Promise<RosterResult> => Promise.resolve({ kind: 'ok', roster }));
  await mount(occs);
}

const chips = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.whose-chip'));
const chipByText = (t: string) => chips().find((b) => b.textContent.includes(t));
const clickChip = (t: string) =>
  void act(() => {
    chipByText(t)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const setQuery = (value: string) =>
  void act(() => {
    const input = container.querySelector<HTMLInputElement>('input.search')!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('ScheduleView — your favourites (the "You" filter)', () => {
  it('selecting You shows only your starred sessions across all days', async () => {
    toggleStar(A.id); // day 16
    toggleStar(C.id); // day 17 — proves the filter spans days, not the active tab
    await mount();

    const you = chipByText('You')!;
    expect(you.getAttribute('aria-pressed')).toBe('false');

    clickChip('You');

    expect(you.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual(['Alpha', 'Gamma']);
    expect(container.querySelectorAll('.result-day')).toHaveLength(2);
    expect(container.querySelector('.filter-status')!.textContent).toBe(
      'Showing your favourites · 2 matches',
    );
  });

  it('search narrows within your favourites (the two filters compose)', async () => {
    toggleStar(A.id);
    toggleStar(C.id);
    await mount();
    clickChip('You');

    setQuery('Gamma');

    expect(titles()).toEqual(['Gamma']);
    expect(container.querySelector('.filter-status')!.textContent).toBe(
      'Your favourites matching “Gamma” · 1 match',
    );
  });

  it('shows an actionable empty state when nothing is starred', async () => {
    await mount();
    clickChip('You');
    expect(titles()).toEqual([]);
    expect(container.querySelector('.results-summary')!.textContent).toContain('No favourites yet');
  });

  it('on plain web the picker is just [Everyone · You] — no crew chips', async () => {
    await mount();
    expect(chips().map((c) => c.textContent.replace('★', '').trim())).toEqual(['Everyone', 'You']);
  });
});

describe('ScheduleView — crew ("also going" + whose favourites)', () => {
  it('shows "also going" chips for crew who starred a session; excludes ghosts and self', async () => {
    sessionRef.current = {
      initData: 'x',
      startParam: null,
      user: { id: 99, firstName: 'Me' },
      authDate: null,
      isTelegram: true,
    };
    const roster: Roster = [
      { userId: 10, displayName: 'Val', ghost: false, plans: [{ occurrenceId: A.id }] },
      { userId: 99, displayName: 'Myself', ghost: false, plans: [{ occurrenceId: A.id }] },
      { userId: 12, displayName: 'Ghosty', ghost: true, plans: [{ occurrenceId: A.id }] },
    ];
    await mountWithCrew(roster);

    const alpha = rowByTitle('Alpha')!;
    const going = alpha.querySelector('.going');
    expect(going).not.toBeNull();
    expect(going!.textContent).toContain('Val');
    expect(going!.textContent).not.toContain('Myself'); // self excluded
    expect(going!.textContent).not.toContain('Ghosty'); // ghost excluded

    // Beta was starred by nobody → no "also going" row.
    expect(rowByTitle('Beta')!.querySelector('.going')).toBeNull();
  });

  it('a crew member chip filters the schedule to that member’s favourites', async () => {
    const roster: Roster = [
      { userId: 10, displayName: 'Val', ghost: false, plans: [{ occurrenceId: C.id }] },
    ];
    await mountWithCrew(roster);

    // Everyone (default) → all four sessions reachable.
    expect(chipByText('Val')).toBeTruthy();

    clickChip('Val');

    expect(titles()).toEqual(['Gamma']); // only Val's star
    expect(container.querySelector('.filter-status')!.textContent).toBe(
      'Showing Val’s favourites · 1 match',
    );

    clickChip('Everyone');
    expect(container.querySelector('.filter-status')).toBeNull(); // filter cleared
  });
});

describe('ScheduleView — now separator in search results', () => {
  it('renders the now divider inside search results on today’s section', async () => {
    await mount();
    setQuery('a');
    expect(container.querySelector('.now-sep')).not.toBeNull();
  });
});

describe('ScheduleView — jump-to-now FAB', () => {
  it('shows the FAB on a con day, scrolls the now separator in, and moves focus to it', async () => {
    let scrolled = 0;
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {
      scrolled++;
    };
    await mount();

    const fab = container.querySelector<HTMLButtonElement>('.fab');
    expect(fab).not.toBeNull();
    expect(fab!.textContent.trim()).toBe('Jump to now');

    void act(() => {
      fab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(scrolled).toBeGreaterThan(0);
    const nowSep = container.querySelector('.now-sep');
    expect(nowSep).not.toBeNull();
    expect(document.activeElement).toBe(nowSep);
  });

  it('hides the FAB when today is outside the con', async () => {
    configureNow('?now=2026-08-01T11:00:00-06:00');
    await mount();
    expect(container.querySelector('.fab')).toBeNull();
  });

  it('hides the FAB when a filter is active but today has no matching sessions', async () => {
    toggleStar(C.id);
    await mount();
    expect(container.querySelector('.fab')).not.toBeNull();
    clickChip('You');
    expect(container.querySelector('.fab')).toBeNull();
  });
});
