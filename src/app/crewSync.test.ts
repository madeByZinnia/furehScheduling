import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TelegramSession } from './telegram-session';
import type { OccurrenceId } from '../data/ids';

// startAutoSync reads the real (module-memoized) session via getTelegramSession.
// Mock it so we can flip between a Telegram and a plain-web session per test. The
// pure fns (buildSyncBody/postSync/fetchRoster) take the session explicitly and
// don't touch this mock.
const { sessionRef } = vi.hoisted(() => ({
  sessionRef: { current: null as TelegramSession | null },
}));
vi.mock('./telegram-session', () => ({
  getTelegramSession: () => sessionRef.current,
}));

import {
  buildSyncBody,
  postSync,
  fetchRoster,
  startAutoSync,
  type Roster,
} from './crewSync';
import { toggleStar, __resetStars } from './stars';
import { setGhost, __resetGhost } from './ghost';

function tgSession(initData: string | null): TelegramSession {
  return {
    initData,
    startParam: null,
    user: null,
    authDate: null,
    isTelegram: initData !== null,
  };
}

const TG = tgSession('user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc');
const WEB = tgSession(null);
const OCC_A = 'CZKVLN@2026-07-16T10:00:00-06:00' as OccurrenceId;

function jsonResponse(data: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(data) } as unknown as Response;
}

describe('buildSyncBody — pure, never leaks a chatId', () => {
  it('telegram session → body with initData + ghost + stars, NO chatId', () => {
    const body = buildSyncBody(TG, true, ['a', 'b']);
    expect(body).toEqual({ initData: TG.initData, ghost: true, stars: ['a', 'b'] });
    expect(body !== null && !('chatId' in body)).toBe(true);
  });

  it('non-telegram session → null', () => {
    expect(buildSyncBody(WEB, false, ['a'])).toBeNull();
  });

  it('telegram session with null initData → null', () => {
    expect(buildSyncBody(tgSession(null), false, [])).toBeNull();
  });
});

describe('postSync', () => {
  it('telegram → POSTs the right JSON body to /api/sync exactly once', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));
    const ok = await postSync(TG, true, ['x'], fetchFn);

    expect(ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sync');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toEqual({ initData: TG.initData, ghost: true, stars: ['x'] });
    expect('chatId' in sent).toBe(false);
  });

  it('non-telegram → returns false and never calls fetch', async () => {
    const fetchFn = vi.fn();
    expect(await postSync(WEB, false, [], fetchFn as unknown as typeof fetch)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('non-ok status → returns false', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false));
    expect(await postSync(TG, false, [], fetchFn as unknown as typeof fetch)).toBe(false);
  });

  it('fetch rejecting → returns false, does not throw', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(postSync(TG, false, [], fetchFn as unknown as typeof fetch)).resolves.toBe(false);
  });
});

describe('fetchRoster — RosterResult distinguishes the four outcomes', () => {
  it('good body → { kind: "ok", roster } with typed entries', async () => {
    const payload = {
      roster: [
        {
          userId: 7,
          displayName: 'Rin',
          ghost: false,
          plans: [{ occurrenceId: 'a', title: 'Reg', start: '2026', room: 'Hall' }],
        },
        // Malformed plan (no occurrenceId) is dropped; entry still parses.
        { userId: 8, displayName: 'Kit', ghost: true, plans: [{ nope: 1 }] },
      ],
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const result = await fetchRoster(TG, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/roster');
    expect(JSON.parse(init.body as string)).toEqual({ initData: TG.initData });

    const expected: Roster = [
      {
        userId: 7,
        displayName: 'Rin',
        ghost: false,
        plans: [{ occurrenceId: 'a', title: 'Reg', start: '2026', room: 'Hall' }],
      },
      { userId: 8, displayName: 'Kit', ghost: true, plans: [] },
    ];
    expect(result).toEqual({ kind: 'ok', roster: expected });
  });

  it('valid but EMPTY roster → { kind: "ok", roster: [] } (NOT an error)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ roster: [] }));
    expect(await fetchRoster(TG, fetchFn as unknown as typeof fetch)).toEqual({
      kind: 'ok',
      roster: [],
    });
  });

  it('non-telegram → { kind: "non-telegram" }, no fetch', async () => {
    const fetchFn = vi.fn();
    expect(await fetchRoster(WEB, fetchFn as unknown as typeof fetch)).toEqual({
      kind: 'non-telegram',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('malformed body (roster not an array) → { kind: "error" }, NOT ok with []', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ roster: 'nope' }));
    expect(await fetchRoster(TG, fetchFn as unknown as typeof fetch)).toEqual({
      kind: 'error',
    });
  });

  it('malformed body (top-level not an object shape, e.g. {}) → { kind: "error" }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));
    expect(await fetchRoster(TG, fetchFn as unknown as typeof fetch)).toEqual({
      kind: 'error',
    });
  });

  it('non-2xx (e.g. 500) → { kind: "error" }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ roster: [] }, false));
    expect(await fetchRoster(TG, fetchFn as unknown as typeof fetch)).toEqual({
      kind: 'error',
    });
  });

  it('network error → { kind: "error" }, does not throw', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchRoster(TG, fetchFn as unknown as typeof fetch)).resolves.toEqual({
      kind: 'error',
    });
  });
});

describe('startAutoSync — debounced push', () => {
  beforeEach(() => {
    __resetStars();
    __resetGhost();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionRef.current = null;
  });

  it('coalesces a burst of changes into ONE push after the window', async () => {
    sessionRef.current = TG;
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));
    const stop = startAutoSync({ debounceMs: 800, fetchFn: fetchFn as unknown as typeof fetch });

    // startAutoSync fires an initial seed schedule; each toggle re-arms it.
    toggleStar(OCC_A);
    setGhost(true);
    toggleStar(OCC_A);
    expect(fetchFn).not.toHaveBeenCalled(); // still inside the window

    await vi.advanceTimersByTimeAsync(800);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sync');
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.ghost).toBe(true);
    expect('chatId' in sent).toBe(false);

    stop();
  });

  it('unsubscribe cancels a pending sync', async () => {
    sessionRef.current = TG;
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));
    const stop = startAutoSync({ debounceMs: 800, fetchFn: fetchFn as unknown as typeof fetch });

    toggleStar(OCC_A);
    stop(); // clears the pending timer
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('non-telegram → no-op, no listeners, no fetch', async () => {
    sessionRef.current = WEB;
    const fetchFn = vi.fn();
    const stop = startAutoSync({ debounceMs: 800, fetchFn: fetchFn as unknown as typeof fetch });

    toggleStar(OCC_A);
    setGhost(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchFn).not.toHaveBeenCalled();
    stop();
  });
});
