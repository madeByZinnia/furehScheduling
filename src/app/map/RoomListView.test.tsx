// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Occurrence } from '../../data/expand';
import type { ItemCode, OccurrenceId } from '../../data/ids';
import { __resetStars, toggleStar } from '../stars';
import { RoomListView } from './RoomListView';

function occ(p: { code: string; start: string; title: string; room?: string | null }): Occurrence {
  return {
    id: `${p.code}@${p.start}` as OccurrenceId,
    code: p.code as ItemCode,
    title: p.title,
    abstract: '',
    track: null,
    room: p.room ?? null,
    start: p.start,
    end: p.start,
    day: p.start.slice(0, 10),
  };
}

// Two rooms out of alpha order in the input ("Zebra" before "Alpha"), one room
// ("Alpha") with two sessions, and a room-less occurrence that must be excluded.
const A1 = occ({ code: 'A1', start: '2026-07-16T10:00:00-06:00', title: 'A one', room: 'Alpha' });
const A2 = occ({ code: 'A2', start: '2026-07-16T12:00:00-06:00', title: 'A two', room: 'Alpha' });
const Z1 = occ({ code: 'Z1', start: '2026-07-16T11:00:00-06:00', title: 'Z one', room: 'Zebra' });
const NOROOM = occ({ code: 'NR', start: '2026-07-16T13:00:00-06:00', title: 'No room', room: null });
const OCCS = [Z1, A1, A2, NOROOM];

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

const items = () => Array.from(container.querySelectorAll<HTMLElement>('.room-list-item'));
const names = () => items().map((li) => li.querySelector('.room-name')!.textContent);
const itemByName = (name: string) =>
  items().find((li) => li.querySelector('.room-name')!.textContent === name)!;

const mount = (occs: Occurrence[] = OCCS) =>
  void act(() => {
    render(<RoomListView occurrences={occs} />, container);
  });

describe('RoomListView', () => {
  it('lists rooms unique and alphabetically sorted, excluding room-less occurrences', () => {
    mount();
    expect(names()).toEqual(['Alpha', 'Zebra']); // sorted; deduped; NOROOM dropped
  });

  it('shows the correct session count per room (singular vs plural)', () => {
    mount();
    expect(itemByName('Alpha').querySelector('.room-count')!.textContent).toBe('2 sessions');
    expect(itemByName('Zebra').querySelector('.room-count')!.textContent).toBe('1 session');
  });

  it('shows no star badge when nothing in a room is starred', () => {
    mount();
    expect(itemByName('Alpha').querySelector('.room-stars')).toBeNull();
    expect(itemByName('Zebra').querySelector('.room-stars')).toBeNull();
  });

  it('reflects useStars: starring an occurrence shows its room badge with the count as TEXT', () => {
    mount();
    // Star both Alpha sessions; Zebra stays unstarred.
    void act(() => {
      toggleStar(A1.id);
      toggleStar(A2.id);
    });

    const badge = itemByName('Alpha').querySelector<HTMLElement>('.room-stars')!;
    expect(badge).not.toBeNull();
    // A11y hard requirement: the count is carried by TEXT (and an aria-label),
    // NOT by colour/opacity alone. This kills an opacity-only mutation.
    expect(badge.textContent).toContain('2');
    expect(badge.getAttribute('aria-label')).toBe('2 starred');
    // The star SHAPE is present too.
    expect(badge.textContent).toContain('★');

    // Zebra was not starred → still no badge.
    expect(itemByName('Zebra').querySelector('.room-stars')).toBeNull();
  });

  it('only counts stars that belong to the room (a star elsewhere does not leak)', () => {
    mount();
    void act(() => toggleStar(Z1.id));
    expect(itemByName('Zebra').querySelector('.room-stars')!.textContent).toContain('1');
    expect(itemByName('Alpha').querySelector('.room-stars')).toBeNull();
  });

  it('renders an empty state when there are no rooms', () => {
    mount([NOROOM]); // only a room-less occurrence
    expect(items()).toHaveLength(0);
    expect(container.querySelector('.empty')).not.toBeNull();
  });
});
