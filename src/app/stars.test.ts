import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OccurrenceId } from '../data/ids';
import { isStarred, toggleStar, starCount, __resetStars } from './stars';
import { setActiveCon } from './con';

const A = 'CZKVLN@2026-07-16T10:00:00-06:00' as OccurrenceId;
const B = 'CZKVLN@2026-07-17T10:00:00-06:00' as OccurrenceId;

describe('stars — per-occurrence, localStorage', () => {
  // These run under the default (unresolved) con → the 'fureh' namespace.
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

  it('persists to localStorage under the active con namespace', () => {
    toggleStar(A);
    toggleStar(B);
    // No con resolved in this suite → the 'fureh' fallback namespace.
    expect(JSON.parse(localStorage.getItem('fureh.stars.v1')!)).toEqual([A, B]);
    expect(starCount()).toBe(2);
  });
});

/**
 * DISCRIMINATIVE namespacing: the stars store must key on the ACTIVE con, not a
 * hardcoded `fureh.` prefix. `setActiveCon` flips the con singleton at runtime;
 * the store reads `conKey()` on each persist/load, so a write under `tos` must
 * land in `tos.stars.v1` and be invisible when the active con switches to
 * `fureh`. A store still using a literal `fureh.stars.v1` KEY FAILS this.
 */
describe('stars — per-con localStorage namespacing', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    setActiveCon('fureh'); // restore the shared singleton for later suites
    localStorage.clear();
  });

  it('writes to the ACTIVE con key and does not leak across cons', async () => {
    // Re-import stars fresh so its module-eval KEY resolves against `tos`.
    setActiveCon('tos');
    vi.resetModules();
    const tosStars = await import('./stars');
    tosStars.toggleStar(A);

    // The write landed in the tos namespace, NOT the fureh one.
    expect(JSON.parse(localStorage.getItem('tos.stars.v1')!)).toEqual([A]);
    expect(localStorage.getItem('fureh.stars.v1')).toBeNull();

    // Switch to fureh and re-import: the same occurrence id reads as 0 stars,
    // because fureh's namespace is a different bucket.
    const con = await import('./con');
    con.setActiveCon('fureh');
    vi.resetModules();
    const furehStars = await import('./stars');
    expect(furehStars.isStarred(A)).toBe(false);
    expect(furehStars.starCount()).toBe(0);
  });

  it('ghost and displayName are also per-con namespaced (not hardcoded fureh)', async () => {
    setActiveCon('tos');
    vi.resetModules();
    const ghost = await import('./ghost');
    const profile = await import('./profile');
    ghost.setGhost(true);
    profile.setDisplayName('Rai');

    // Writes land in the tos namespace, not fureh.
    expect(localStorage.getItem('tos.ghost.v1')).not.toBeNull();
    expect(localStorage.getItem('fureh.ghost.v1')).toBeNull();
    expect(localStorage.getItem('tos.displayName.v1')).not.toBeNull();
    expect(localStorage.getItem('fureh.displayName.v1')).toBeNull();
  });
});
