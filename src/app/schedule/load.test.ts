import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadSchedule, scheduleUrl } from './load';

// A minimal on-the-wire schedule shape. Kept as a plain object (not the branded
// `Schedule` type) because parsed JSON carries no ItemCode/OccurrenceId brands.
const SAMPLE = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  occurrences: [
    {
      id: 'X@2026-08-08T10:00:00-07:00',
      code: 'X',
      title: 'Sample',
      abstract: '',
      track: null,
      room: null,
      start: '2026-08-08T10:00:00-07:00',
      end: '2026-08-08T11:00:00-07:00',
      day: '2026-08-08',
    },
  ],
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('scheduleUrl — pure URL choice (pins BOTH branches)', () => {
  it('prod → the worker route', () => {
    expect(scheduleUrl('tos', false)).toBe('/api/schedule?con=tos');
  });

  it('dev → the static file Vite serves at /data/', () => {
    expect(scheduleUrl('tos', true)).toBe('/data/tos.json');
  });

  it('encodes the con id in both branches', () => {
    expect(scheduleUrl('a b', false)).toBe('/api/schedule?con=a%20b');
    expect(scheduleUrl('a b', true)).toBe('/data/a%20b.json');
  });
});

describe('loadSchedule', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Vitest runs in Vite "test" mode, where import.meta.env.DEV is true, so
  // loadSchedule takes the dev branch and hits /data/<con>.json directly. Pin
  // that assumption so a config change that flips DEV is caught here.
  it('DEV mode: fetches /data/<con>.json and returns the parsed Schedule', async () => {
    expect(import.meta.env.DEV).toBe(true);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    vi.stubGlobal('fetch', fetchFn);

    const schedule = await loadSchedule('tos');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toBe('/data/tos.json');
    expect(schedule.occurrences).toHaveLength(1);
    expect(schedule.generatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    await expect(loadSchedule('tos')).rejects.toThrow(/HTTP 500/);
  });

  it('throws on a shape missing the occurrences array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ generatedAt: 'x' })));
    await expect(loadSchedule('tos')).rejects.toThrow(/malformed/);
  });

  it('throws when generatedAt is missing (not just occurrences)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ occurrences: SAMPLE.occurrences })));
    await expect(loadSchedule('tos')).rejects.toThrow(/malformed/);
  });

  it('throws on garbage occurrence elements (null / number / empty object)', async () => {
    // The loose "is an array" check would have accepted these; consumers would
    // then crash dereferencing occurrence fields.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ generatedAt: 'x', occurrences: [null, 42, {}] })),
    );
    await expect(loadSchedule('tos')).rejects.toThrow(/malformed/);
  });

  it('throws a con-scoped error (not a bare SyntaxError) on non-JSON body', async () => {
    // e.g. the SPA index.html shell served for a missing asset.
    const htmlRes = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlRes));
    // Con-scoped message (names the con), not a bare SyntaxError.
    await expect(loadSchedule('tos')).rejects.toThrow(/"tos".*not valid JSON/);
  });

  it('rejects occurrences whose hosts array contains non-strings', async () => {
    const bad = {
      generatedAt: 'x',
      occurrences: [{ ...SAMPLE.occurrences[0], hosts: [null, 42, {}] }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(bad)));
    await expect(loadSchedule('tos')).rejects.toThrow(/malformed/);
  });
});
