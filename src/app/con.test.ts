import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveConId } from './con';

/**
 * The active con is resolved once, at module EVAL. To drive the resolver
 * discriminatively we set up `window.location` (via history.replaceState) and
 * `localStorage` FIRST, then `vi.resetModules()` + a fresh dynamic import so the
 * module re-evaluates against the state we just staged.
 */
async function loadCon(url: string): Promise<typeof import('./con')> {
  window.history.replaceState({}, '', url);
  vi.resetModules();
  return import('./con');
}

describe('con — active-con resolver', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('picks the con from ?con=<id>', async () => {
    const m = await loadCon('/?con=tos');
    expect(m.activeCon().id).toBe('tos');
  });

  it('falls back to localStorage app.lastCon.v1 when no ?con is present', async () => {
    localStorage.setItem('app.lastCon.v1', 'canfurence');
    const m = await loadCon('/');
    expect(m.activeCon().id).toBe('canfurence');
  });

  it('?con beats localStorage', async () => {
    localStorage.setItem('app.lastCon.v1', 'canfurence');
    const m = await loadCon('/?con=tos');
    expect(m.activeCon().id).toBe('tos');
  });

  it('an unknown ?con falls through to the next source', async () => {
    localStorage.setItem('app.lastCon.v1', 'fureh');
    const m = await loadCon('/?con=zzz');
    // zzz is not a valid con, so resolution continues to localStorage.
    expect(m.activeCon().id).toBe('fureh');
  });

  it('conKey namespaces differ between tos and fureh', async () => {
    const tos = await loadCon('/?con=tos');
    expect(tos.conKey('stars.v1')).toBe('tos.stars.v1');

    const fureh = await loadCon('/?con=fureh');
    expect(fureh.conKey('stars.v1')).toBe('fureh.stars.v1');
  });

  it('resolves the con from a Telegram launch hash (tgWebAppStartParam) end-to-end', async () => {
    // No ?con and no localStorage — the ONLY signal is the launch hash. This
    // exercises the real global reader (readStartParam) + fromStartParam, so a
    // `readStartParam() => null` mutation is caught here (the pure tests miss it).
    const m = await loadCon('/#tgWebAppStartParam=tos__42');
    expect(m.activeCon().id).toBe('tos');
  });
});

/**
 * The pure resolver — driven entirely by explicit inputs, so priority ordering
 * is asserted without staging globals or resetting modules. `outside` is a date
 * that falls in NO con window, isolating the earlier sources.
 */
describe('resolveConId — pure priority chain', () => {
  const outside = new Date('2026-01-01T12:00:00Z');

  it('1. ?con wins over everything', () => {
    expect(resolveConId('?con=tos', 'canfurence__42', 'fureh', outside)).toBe('tos');
  });

  it('2. Telegram start_param (con id = leading token before the FIRST __) when no ?con', () => {
    expect(resolveConId('', 'canfurence__42', 'fureh', outside)).toBe('canfurence');
    // Negative numeric chat id (never contains __) leaves the con id clean.
    expect(resolveConId('', 'tos__-1001234', 'fureh', outside)).toBe('tos');
    // The con id is the LEADING token: any extra trailing __ segments belong to
    // the (ignored) chat id, so `tos__-100__99` still resolves to tos — it does
    // NOT fall through.
    expect(resolveConId('', 'tos__-100__99', 'fureh', outside)).toBe('tos');
    // A leading token that isn't a valid con id yields null → fall through.
    expect(resolveConId('', 'zzz__42', 'fureh', outside)).toBe('fureh');
  });

  it('3. stored id when no ?con and no start_param hint', () => {
    expect(resolveConId('', null, 'canfurence', outside)).toBe('canfurence');
  });

  it('4. date-window inference is the LAST resort', () => {
    // A date inside Fureh's non-overlapping window (Jul 16-19) resolves cleanly.
    const duringFureh = new Date('2026-07-17T12:00:00Z');
    expect(resolveConId('', null, null, duringFureh)).toBe('fureh');
    // ToS (Aug 8-9) sits INSIDE Canfurence (Aug 7-9); on an overlapping day the
    // CONS insertion order breaks the tie (canfurence before tos) — which is why
    // date-window is a last resort, never authoritative.
    const overlap = new Date('2026-08-08T12:00:00Z');
    expect(resolveConId('', null, null, overlap)).toBe('canfurence');
  });

  it('4b. date window is evaluated in the con timezone, not the host timezone', () => {
    // 2026-07-16T04:00Z is still 2026-07-15 22:00 in Edmonton (-06:00): BEFORE
    // Fureh opens (07-16). A host-local (e.g. UTC) impl would read 07-16 and
    // wrongly resolve fureh; the tz-aware impl returns null.
    expect(resolveConId('', null, null, new Date('2026-07-16T04:00:00Z'))).toBeNull();
    // 2026-07-20T04:00Z is 2026-07-19 22:00 in Edmonton: STILL Fureh's last day.
    // A UTC impl would read 07-20 and wrongly return null.
    expect(resolveConId('', null, null, new Date('2026-07-20T04:00:00Z'))).toBe('fureh');
  });

  it('5. returns null when no source resolves', () => {
    expect(resolveConId('', null, null, outside)).toBeNull();
  });

  it('unknown values fall through instead of resolving', () => {
    expect(resolveConId('?con=zzz', 'zzz__1', 'zzz', outside)).toBeNull();
    // An unknown ?con still lets a valid stored id win.
    expect(resolveConId('?con=zzz', null, 'tos', outside)).toBe('tos');
  });
});
