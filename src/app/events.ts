import type { TelegramSession } from './telegram-session';

/**
 * Custom-events client — the SPA half of crew custom events. Mirrors crewSync's
 * contract: send the RAW signed `initData` (NEVER a chatId — the Worker derives
 * the crew from HMAC-verified initData), inject `fetch` for tests, coerce every
 * response defensively, and NEVER throw to the caller. A no-op on plain web.
 *
 * Types mirror the Worker's CustomEventView/CustomEventInput by hand; we do NOT
 * import worker code into the SPA bundle. LOCATION IS FREE TEXT ONLY — there is
 * no map/coordinate field anywhere.
 */

export interface EventView {
  eventId: string;
  ownerId: number;
  title: string;
  day: string | null;
  startIso: string | null;
  endIso: string | null;
  location: string | null;
  notes: string | null;
  cancelled: boolean;
  starCount: number;
  viewerStarred: boolean;
  isOwner: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The create/edit payload. All fields sent; the server sets present values. */
export interface EventInput {
  title: string;
  day: string | null;
  startIso: string | null;
  endIso: string | null;
  location: string | null;
  notes: string | null;
}

/** Raw form fields from the create/edit screen (native date/time inputs). */
export interface EventForm {
  title: string;
  location: string;
  day: string; // YYYY-MM-DD or ''
  startTime: string; // HH:MM or ''
  endTime: string; // HH:MM or ''
  notes: string;
}

export type EventListResult =
  | { kind: 'non-telegram' }
  | { kind: 'ok'; events: EventView[] }
  | { kind: 'error' };

/** A mutation outcome the UI can branch on for messaging. */
export type MutationResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; reason: 'non-telegram' | 'not-owner' | 'invalid' | 'error'; message?: string };

/**
 * PURE: fold native date + time fields into an {@link EventInput}. A time needs a
 * day to be meaningful, so startIso/endIso are null unless a day is set; the ISO
 * is a plain `YYYY-MM-DDTHH:MM` string (the Worker stores it opaquely and sorts
 * by startIso). Empty text fields become null.
 */
export function buildEventInput(form: EventForm): EventInput {
  const day = form.day || null;
  const iso = (time: string): string | null => (day && time ? `${day}T${time}` : null);
  return {
    title: form.title.trim(),
    day,
    startIso: iso(form.startTime),
    endIso: iso(form.endTime),
    location: form.location.trim() || null,
    notes: form.notes.trim() || null,
  };
}

function isoTime(iso: string | null): string {
  const m = iso ? /T(\d{2}:\d{2})/.exec(iso) : null;
  return m ? m[1]! : '';
}
function isoDay(iso: string | null): string {
  const m = iso ? /^(\d{4}-\d{2}-\d{2})/.exec(iso) : null;
  return m ? m[1]! : '';
}

/** PURE: pre-fill the create/edit form from an existing event (edit-into-create). */
export function formFromEvent(ev: EventView): EventForm {
  return {
    title: ev.title,
    location: ev.location ?? '',
    day: ev.day ?? isoDay(ev.startIso),
    startTime: isoTime(ev.startIso),
    endTime: isoTime(ev.endIso),
    notes: ev.notes ?? '',
  };
}

/** PURE: a blank form. */
export function emptyForm(): EventForm {
  return { title: '', location: '', day: '', startTime: '', endTime: '', notes: '' };
}

/** PURE: a human "when" line for a card, or null if the event has no day/time. */
export function describeWhen(ev: EventView): string | null {
  const day = ev.day ?? isoDay(ev.startIso);
  const start = isoTime(ev.startIso);
  const end = isoTime(ev.endIso);
  const time = start && end ? `${start}–${end}` : start;
  const parts = [day, time].filter((p) => p !== '');
  return parts.length > 0 ? parts.join(' · ') : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function bool(v: unknown): boolean {
  return v === true;
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** Coerce one unknown value into an EventView, or null if it isn't shaped like one. */
function toEventView(value: unknown): EventView | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.eventId !== 'string' || o.eventId === '') return null;
  if (typeof o.title !== 'string') return null;
  return {
    eventId: o.eventId,
    ownerId: num(o.ownerId),
    title: o.title,
    day: str(o.day),
    startIso: str(o.startIso),
    endIso: str(o.endIso),
    location: str(o.location),
    notes: str(o.notes),
    cancelled: bool(o.cancelled),
    starCount: num(o.starCount),
    viewerStarred: bool(o.viewerStarred),
    isOwner: bool(o.isOwner),
    createdAt: num(o.createdAt),
    updatedAt: num(o.updatedAt),
  };
}

async function postEvents(
  path: string,
  session: TelegramSession,
  extra: object,
  fetchFn: typeof fetch,
): Promise<{ status: number; body: unknown } | null> {
  if (!session.isTelegram || session.initData == null) return null;
  try {
    const res = await fetchFn(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: session.initData, ...extra }),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  } catch {
    return null;
  }
}

/** Map a non-ok HTTP status to a mutation failure reason. */
function failure(status: number, body: unknown): MutationResult<never> {
  const err = (body as { error?: unknown } | null)?.error;
  const msg = typeof err === 'string' ? { message: err } : {};
  const reason = status === 403 ? 'not-owner' : status === 400 ? 'invalid' : 'error';
  return { ok: false, reason, ...msg };
}

/** Pull `.event` out of a mutation response as an EventView, or null. */
function eventFrom(body: unknown): EventView | null {
  if (typeof body !== 'object' || body === null) return null;
  return toEventView((body as Record<string, unknown>).event);
}

/**
 * List all crew custom events (incl. cancelled), each with the viewer's
 * star/owner view. Never throws; distinguishes plain-web / ok / error.
 */
export async function listEvents(
  session: TelegramSession,
  fetchFn: typeof fetch = fetch,
): Promise<EventListResult> {
  const res = await postEvents('/api/events/list', session, {}, fetchFn);
  if (res === null) {
    return !session.isTelegram || session.initData == null
      ? { kind: 'non-telegram' }
      : { kind: 'error' };
  }
  if (res.status < 200 || res.status >= 300) return { kind: 'error' };
  const raw = (res.body as { events?: unknown } | null)?.events;
  if (!Array.isArray(raw)) return { kind: 'error' };
  const events: EventView[] = [];
  for (const item of raw) {
    const ev = toEventView(item);
    if (ev !== null) events.push(ev);
  }
  return { kind: 'ok', events };
}

async function mutateEvent(
  path: string,
  session: TelegramSession,
  extra: object,
  fetchFn: typeof fetch,
): Promise<MutationResult<EventView | null>> {
  const res = await postEvents(path, session, extra, fetchFn);
  if (res === null) {
    return !session.isTelegram || session.initData == null
      ? { ok: false, reason: 'non-telegram' }
      : { ok: false, reason: 'error' };
  }
  if (res.status < 200 || res.status >= 300) return failure(res.status, res.body);
  return { ok: true, value: eventFrom(res.body) };
}

/** Create a custom event owned by the verified user. Empty title → 'invalid'. */
export async function createEvent(
  session: TelegramSession,
  input: EventInput,
  fetchFn: typeof fetch = fetch,
): Promise<MutationResult<EventView | null>> {
  if (input.title.trim() === '') return { ok: false, reason: 'invalid', message: 'title required' };
  return mutateEvent('/api/events/create', session, input, fetchFn);
}

/** Owner-only edit. Non-owner → { reason: 'not-owner' }. */
export async function editEvent(
  session: TelegramSession,
  eventId: string,
  input: EventInput,
  fetchFn: typeof fetch = fetch,
): Promise<MutationResult<EventView | null>> {
  if (input.title.trim() === '') return { ok: false, reason: 'invalid', message: 'title required' };
  return mutateEvent('/api/events/edit', session, { eventId, ...input }, fetchFn);
}

/** Owner-only soft cancel (shows [CANCELLED], never deletes). */
export async function cancelEvent(
  session: TelegramSession,
  eventId: string,
  fetchFn: typeof fetch = fetch,
): Promise<MutationResult> {
  const res = await mutateEvent('/api/events/cancel', session, { eventId }, fetchFn);
  return res.ok ? { ok: true, value: null } : res;
}

/** Star or unstar any crew event. */
export async function starEvent(
  session: TelegramSession,
  eventId: string,
  starred: boolean,
  fetchFn: typeof fetch = fetch,
): Promise<MutationResult> {
  const res = await mutateEvent('/api/events/star', session, { eventId, starred }, fetchFn);
  return res.ok ? { ok: true, value: null } : res;
}

/**
 * Leave the crew. `cancelOwnEvents` MUST come from an explicit, default-unchecked
 * box — leaving is pure privacy unless the user opts to also cancel their events.
 */
export async function leaveCrew(
  session: TelegramSession,
  cancelOwnEvents: boolean,
  fetchFn: typeof fetch = fetch,
): Promise<MutationResult> {
  const res = await mutateEvent('/api/leave', session, { cancelOwnEvents }, fetchFn);
  return res.ok ? { ok: true, value: null } : res;
}
