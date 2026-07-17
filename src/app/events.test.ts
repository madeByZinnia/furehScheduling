import { describe, it, expect, vi } from 'vitest';
import type { TelegramSession } from './telegram-session';
import {
  buildEventInput,
  listEvents,
  createEvent,
  editEvent,
  cancelEvent,
  starEvent,
  leaveCrew,
  formFromEvent,
  describeWhen,
  type EventForm,
  type EventView,
} from './events';

const tg: TelegramSession = {
  initData: 'signed-init-data',
  startParam: null,
  user: null,
  authDate: null,
  isTelegram: true,
};
const web: TelegramSession = {
  initData: null,
  startParam: null,
  user: null,
  authDate: null,
  isTelegram: false,
};

function jsonResponse(data: unknown, status = 200): Response {
  return { status, json: () => Promise.resolve(data) } as unknown as Response;
}

function form(over: Partial<EventForm> = {}): EventForm {
  return { title: '', location: '', day: '', startTime: '', endTime: '', notes: '', ...over };
}

const fullEvent = {
  eventId: 'e1',
  ownerId: 7,
  title: 'Room party',
  day: '2026-07-18',
  startIso: '2026-07-18T22:00',
  endIso: null,
  location: 'Rm 1412',
  notes: null,
  cancelled: false,
  starCount: 2,
  viewerStarred: true,
  isOwner: true,
  createdAt: 1,
  updatedAt: 2,
};

describe('buildEventInput', () => {
  it('folds day + times into ISO strings and trims text', () => {
    const input = buildEventInput(
      form({ title: '  Party  ', location: ' Rm 1412 ', day: '2026-07-18', startTime: '22:00', endTime: '23:30' }),
    );
    expect(input).toEqual({
      title: 'Party',
      day: '2026-07-18',
      startIso: '2026-07-18T22:00',
      endIso: '2026-07-18T23:30',
      location: 'Rm 1412',
      notes: null,
    });
  });

  it('a time with no day is dropped (an ISO needs a day)', () => {
    const input = buildEventInput(form({ title: 'X', startTime: '22:00' }));
    expect(input.day).toBeNull();
    expect(input.startIso).toBeNull();
  });

  it('blank optional fields become null', () => {
    expect(buildEventInput(form({ title: 'X' }))).toEqual({
      title: 'X',
      day: null,
      startIso: null,
      endIso: null,
      location: null,
      notes: null,
    });
  });
});

describe('listEvents', () => {
  it('posts { initData } and coerces the events (cancelled kept, malformed dropped)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        events: [
          fullEvent,
          { ...fullEvent, eventId: 'e2', cancelled: true },
          { title: 'no id — dropped' },
          42,
        ],
      }),
    );
    const res = await listEvents(tg, fetchFn);
    expect(res).toEqual({ kind: 'ok', events: [expect.objectContaining({ eventId: 'e1' }), expect.objectContaining({ eventId: 'e2', cancelled: true })] });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('/api/events/list');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ initData: 'signed-init-data' });
  });

  it('plain web → non-telegram, no fetch', async () => {
    const fetchFn = vi.fn();
    expect(await listEvents(web, fetchFn)).toEqual({ kind: 'non-telegram' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('non-2xx → error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 401));
    expect(await listEvents(tg, fetchFn)).toEqual({ kind: 'error' });
  });

  it('network reject → error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await listEvents(tg, fetchFn)).toEqual({ kind: 'error' });
  });
});

describe('createEvent', () => {
  it('blocks an empty title WITHOUT calling fetch', async () => {
    const fetchFn = vi.fn();
    const res = await createEvent(tg, buildEventInput(form({ title: '   ' })), fetchFn);
    expect(res).toEqual({ ok: false, reason: 'invalid', message: 'title required' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('posts the input and returns the created event', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ event: fullEvent }));
    const res = await createEvent(tg, buildEventInput(form({ title: 'Party', location: 'Rm 1412' })), fetchFn);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value?.eventId).toBe('e1');
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.initData).toBe('signed-init-data');
    expect(body.title).toBe('Party');
    expect(body.location).toBe('Rm 1412');
  });

  it('maps a 400 to reason "invalid" with the server message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'title required' }, 400));
    const res = await createEvent(tg, buildEventInput(form({ title: 'x' })), fetchFn);
    expect(res).toEqual({ ok: false, reason: 'invalid', message: 'title required' });
  });
});

describe('editEvent / cancelEvent / starEvent', () => {
  it('editEvent maps a 403 to reason "not-owner"', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'not owner' }, 403));
    const res = await editEvent(tg, 'e1', buildEventInput(form({ title: 'x' })), fetchFn);
    expect(res).toEqual({ ok: false, reason: 'not-owner', message: 'not owner' });
  });

  it('cancelEvent posts { eventId } and succeeds', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const res = await cancelEvent(tg, 'e1', fetchFn);
    expect(res.ok).toBe(true);
    expect(JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      initData: 'signed-init-data',
      eventId: 'e1',
    });
  });

  it('starEvent posts { eventId, starred }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await starEvent(tg, 'e1', false, fetchFn);
    expect(JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      initData: 'signed-init-data',
      eventId: 'e1',
      starred: false,
    });
  });
});

describe('formFromEvent / describeWhen', () => {
  const base: EventView = { ...fullEvent, viewerStarred: false };

  it('formFromEvent pre-fills fields and round-trips through buildEventInput', () => {
    const form = formFromEvent(base);
    expect(form).toEqual({
      title: 'Room party',
      location: 'Rm 1412',
      day: '2026-07-18',
      startTime: '22:00',
      endTime: '',
      notes: '',
    });
    expect(buildEventInput(form)).toMatchObject({ startIso: '2026-07-18T22:00', endIso: null });
  });

  it('describeWhen formats day + time, or returns null when there is none', () => {
    expect(describeWhen(base)).toBe('2026-07-18 · 22:00');
    expect(describeWhen({ ...base, endIso: '2026-07-18T23:30' })).toBe('2026-07-18 · 22:00–23:30');
    expect(
      describeWhen({ ...base, day: null, startIso: null, endIso: null }),
    ).toBeNull();
  });
});

describe('leaveCrew', () => {
  it('sends the explicit cancelOwnEvents flag', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await leaveCrew(tg, true, fetchFn);
    expect(JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      initData: 'signed-init-data',
      cancelOwnEvents: true,
    });
  });

  it('defaults are the caller’s concern — false is passed through verbatim', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await leaveCrew(tg, false, fetchFn);
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.cancelOwnEvents).toBe(false);
  });
});
