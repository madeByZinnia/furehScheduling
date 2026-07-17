import { describe, it, expect, beforeEach } from 'vitest';
import type { OccurrenceId } from '../data/ids';
import { isStarred, toggleStar, starCount, __resetStars } from './stars';

const A = 'CZKVLN@2026-07-16T10:00:00-06:00' as OccurrenceId;
const B = 'CZKVLN@2026-07-17T10:00:00-06:00' as OccurrenceId;

describe('stars — per-occurrence, localStorage', () => {
  beforeEach(() => __resetStars());

  it('toggles a single occurrence without touching its siblings', () => {
    expect(isStarred(A)).toBe(false);
    toggleStar(A);
    expect(isStarred(A)).toBe(true);
    // Starring one occurrence of CZKVLN must NOT star another (the item bug).
    expect(isStarred(B)).toBe(false);
    expect(starCount()).toBe(1);
  });

  it('unstars on second toggle', () => {
    toggleStar(A);
    toggleStar(A);
    expect(isStarred(A)).toBe(false);
    expect(starCount()).toBe(0);
  });

  it('persists to localStorage across a reload of the set', () => {
    toggleStar(A);
    toggleStar(B);
    expect(JSON.parse(localStorage.getItem('fureh.stars.v1')!)).toEqual([A, B]);
    expect(starCount()).toBe(2);
  });
});
