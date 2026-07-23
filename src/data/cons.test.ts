import { describe, it, expect } from 'vitest';
import { getCon, CONS, DEFAULT_CON, type ConId } from './cons';

/**
 * Pin Fureh's config to the pre-multi-con hardcoded constants. Each expected
 * literal cites the file it was copied from — if a later tic edits one of those
 * constants without updating cons.ts, this test fails loudly.
 */
describe('cons — registry', () => {
  it('getCon("fureh") reproduces the hardcoded constants exactly', () => {
    const c = getCon('fureh');
    expect(c).not.toBeNull();
    expect(c!.tz).toBe('America/Edmonton'); // src/data/expand.ts CON_TZ; src/app/datetime.ts TZ
    expect(c!.ics.prodId).toBe('-//fureh-schedules//Fur-Eh 2026 Schedule//EN'); // src/app/ics.ts DEFAULT_PRODID
    expect(c!.ics.uidDomain).toBe('fureh-schedules'); // src/app/ics.ts UID_DOMAIN
    expect(c!.ics.filename).toBe('fureh-2026.ics'); // src/app/MeExport.tsx FILENAME
    expect(c!.name).toBe('Fur-Eh 2026'); // src/app/App.tsx <h1>
    expect(c!.storageKey).toBe('fureh'); // src/app/stars.ts KEY prefix of 'fureh.stars.v1'
  });

  it('getCon("nope") returns null on an unknown id', () => {
    expect(getCon('nope')).toBeNull();
    // Must not match inherited Object props either.
    expect(getCon('toString')).toBeNull();
    expect(getCon('')).toBeNull();
  });

  it('has all three cons and DEFAULT_CON is fureh', () => {
    expect(Object.keys(CONS).sort()).toEqual(['canfurence', 'fureh', 'tos']);
    expect(DEFAULT_CON).toBe('fureh');
  });

  it('every con storageKey equals its id', () => {
    for (const id of Object.keys(CONS) as ConId[]) {
      expect(CONS[id].storageKey).toBe(id);
      expect(CONS[id].id).toBe(id);
    }
  });
});
