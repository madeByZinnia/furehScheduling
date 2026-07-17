import { describe, it, expect } from 'vitest';
import type { Occurrence } from '../../data/expand';
import type { ItemCode, OccurrenceId } from '../../data/ids';
import {
  matchesSearch,
  filterOccurrences,
  dayTabs,
  defaultDayIndex,
  groupByTime,
  nowSeparatorIndex,
} from './filter';

function occ(p: Partial<Occurrence> & { start: string; day: string }): Occurrence {
  return {
    id: `${p.code ?? 'X'}@${p.start}` as OccurrenceId,
    code: (p.code ?? 'X') as ItemCode,
    title: p.title ?? 'Untitled',
    abstract: p.abstract ?? '',
    track: p.track ?? null,
    room: p.room ?? null,
    start: p.start,
    end: p.end ?? p.start,
    day: p.day,
  };
}

describe('matchesSearch', () => {
  const o = occ({
    start: '2026-07-16T10:00:00-06:00',
    day: '2026-07-16',
    title: 'Headless Lounge',
    abstract: 'Chill and vibe',
    track: 'Social',
    room: 'Wyndham - Gallery 1',
  });

  it('empty query matches everything', () => {
    expect(matchesSearch(o, '')).toBe(true);
    expect(matchesSearch(o, '   ')).toBe(true);
  });

  it('matches title/abstract/track/room case-insensitively', () => {
    expect(matchesSearch(o, 'headless')).toBe(true);
    expect(matchesSearch(o, 'VIBE')).toBe(true);
    expect(matchesSearch(o, 'social')).toBe(true);
    expect(matchesSearch(o, 'gallery')).toBe(true);
  });

  it('does not match absent fields', () => {
    expect(matchesSearch(o, 'nonexistent')).toBe(false);
  });
});

describe('filterOccurrences', () => {
  it('returns all when query is blank, filtered otherwise', () => {
    const list = [
      occ({ start: '2026-07-16T10:00:00-06:00', day: '2026-07-16', title: 'Opening' }),
      occ({ start: '2026-07-16T11:00:00-06:00', day: '2026-07-16', title: 'Panel' }),
    ];
    expect(filterOccurrences(list, '')).toHaveLength(2);
    expect(filterOccurrences(list, 'open')).toHaveLength(1);
  });
});

describe('dayTabs + defaultDayIndex', () => {
  const list = [
    occ({ start: '2026-07-17T09:00:00-06:00', day: '2026-07-17' }),
    occ({ start: '2026-07-16T12:00:00-06:00', day: '2026-07-16' }),
    occ({ start: '2026-07-16T08:00:00-06:00', day: '2026-07-16' }),
    occ({ start: '2026-07-18T10:00:00-06:00', day: '2026-07-18' }),
  ];

  it('lists distinct days ascending with the earliest start', () => {
    const tabs = dayTabs(list);
    expect(tabs.map((t) => t.day)).toEqual(['2026-07-16', '2026-07-17', '2026-07-18']);
    expect(tabs[0]!.startISO).toBe('2026-07-16T08:00:00-06:00');
  });

  it('picks the day containing now, clamping before/after the con', () => {
    const tabs = dayTabs(list);
    expect(defaultDayIndex(tabs, new Date('2026-07-17T15:00:00-06:00'))).toBe(1);
    expect(defaultDayIndex(tabs, new Date('2026-07-10T00:00:00-06:00'))).toBe(0); // before
    expect(defaultDayIndex(tabs, new Date('2026-08-01T00:00:00-06:00'))).toBe(2); // after
  });
});

describe('groupByTime + nowSeparatorIndex', () => {
  const day = '2026-07-16';
  const list = [
    occ({ start: '2026-07-16T10:00:00-06:00', day, title: 'B' }),
    occ({ start: '2026-07-16T10:00:00-06:00', day, title: 'A' }), // same time → same group
    occ({ start: '2026-07-16T12:00:00-06:00', day, title: 'C' }),
    occ({ start: '2026-07-17T09:00:00-06:00', day: '2026-07-17', title: 'OtherDay' }),
  ];

  it('groups same-start occurrences and sorts groups/items', () => {
    const groups = groupByTime(list, day);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.startISO).toBe('2026-07-16T10:00:00-06:00');
    expect(groups[0]!.items.map((o) => o.title)).toEqual(['A', 'B']); // title-sorted within group
    expect(groups[1]!.items.map((o) => o.title)).toEqual(['C']);
  });

  it('places the now separator before the first future group', () => {
    const groups = groupByTime(list, day);
    // 11:00 is after the 10:00 group, before the 12:00 group → index 1
    expect(nowSeparatorIndex(groups, new Date('2026-07-16T11:00:00-06:00'))).toBe(1);
    // before everything
    expect(nowSeparatorIndex(groups, new Date('2026-07-16T09:00:00-06:00'))).toBe(0);
    // after everything
    expect(nowSeparatorIndex(groups, new Date('2026-07-16T23:00:00-06:00'))).toBe(2);
  });
});
