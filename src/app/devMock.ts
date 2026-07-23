import type { OccurrenceId } from '../data/ids';
import type { Roster } from './crewSync';
import type { EventView, EventInput, EventListResult, MutationResult } from './events';
import { __setCrewLoader, refreshCrew } from './crew';

/**
 * DEV-ONLY mock data so the crew + custom-events UI can be exercised in a plain
 * browser (no Telegram). Enable by visiting the app with `?mock` in dev
 * (`npm run dev` → http://localhost:5173/?mock). Gated on `import.meta.env.DEV`,
 * so it is inert in production builds and never affects the real Telegram flow.
 *
 * This is a throwaway testing aid — safe to delete once the UI is signed off.
 */

export function mockEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('mock')
  );
}

// A tiny inline fixture of occurrence ids so the mock crew has plans to show.
// (Previously sliced from the baked schedule.json; the SPA no longer depends on
// that file. These synthetic ids won't line up with the runtime-loaded schedule,
// so "also going" chips only light up if a real occurrence happens to share an
// id — good enough for the dev-only crew/events UI this mock exists to exercise.)
const occIds: OccurrenceId[] = [
  'MOCK1@2026-07-16T10:00:00-06:00',
  'MOCK2@2026-07-16T12:00:00-06:00',
  'MOCK3@2026-07-17T10:00:00-06:00',
  'MOCK4@2026-07-17T12:00:00-06:00',
  'MOCK5@2026-07-18T10:00:00-06:00',
  'MOCK6@2026-07-18T12:00:00-06:00',
] as OccurrenceId[];
const plansFor = (from: number, to: number) => occIds.slice(from, to).map((id) => ({ occurrenceId: id }));

export const MOCK_ROSTER: Roster = [
  // The real /api/roster includes the requesting user, so you appear in the
  // Members list too. (On plain web the mock has no Telegram identity, so it
  // can't fold "you" into the picker's "You" chip — Zinnia shows as a normal
  // member chip here; inside Telegram she'd be excluded from the picker/going.)
  { userId: 100, displayName: 'Zinnia', ghost: false, plans: plansFor(0, 2) },
  { userId: 101, displayName: 'Valerie', ghost: false, plans: plansFor(0, 3) },
  { userId: 102, displayName: 'Maximiliana-Longname', ghost: false, plans: plansFor(1, 4) },
  { userId: 103, displayName: 'Moss', ghost: false, plans: [] },
  { userId: 104, displayName: 'Juno', ghost: true, plans: [] },
  { userId: 105, displayName: 'Pip', ghost: false, plans: plansFor(2, 5) },
];

function ev(over: Partial<EventView> & { eventId: string; title: string }): EventView {
  return {
    ownerId: 101,
    day: null,
    startIso: null,
    endIso: null,
    location: null,
    notes: null,
    cancelled: false,
    starCount: 0,
    viewerStarred: false,
    isOwner: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

let events: EventView[] = [
  ev({
    eventId: 'm1',
    title: 'Room party — Rm 1412',
    isOwner: true,
    day: '2026-07-18',
    startIso: '2026-07-18T22:00',
    location: 'Rm 1412 · Wyndham 14th floor',
    notes: 'BYOB, quiet after midnight',
    starCount: 3,
  }),
  ev({ eventId: 'm2', title: 'Late-night snacc run', isOwner: true, cancelled: true, day: '2026-07-17', startIso: '2026-07-17T01:00', starCount: 1 }),
  ev({ eventId: 'o1', title: "Valerie's fursuit meetup", isOwner: false, day: '2026-07-18', startIso: '2026-07-18T14:00', endIso: '2026-07-18T15:00', location: 'Atrium', starCount: 4, viewerStarred: true }),
];

const list = (): EventListResult => ({ kind: 'ok', events: events.map((e) => ({ ...e })) });
const fields = (input: EventInput) => ({
  title: input.title,
  day: input.day,
  startIso: input.startIso,
  endIso: input.endIso,
  location: input.location,
  notes: input.notes,
});

/** Injectable props for <EventsPanel> that drive an in-memory event list. */
export const mockEventsProps = {
  load: (): Promise<EventListResult> => Promise.resolve(list()),
  onCreate: (input: EventInput): Promise<MutationResult<EventView | null>> => {
    const created = ev({ eventId: `mock-${events.length + 1}`, isOwner: true, ...fields(input) });
    events = [...events, created];
    return Promise.resolve({ ok: true, value: created });
  },
  onEdit: (id: string, input: EventInput): Promise<MutationResult<EventView | null>> => {
    events = events.map((e) => (e.eventId === id ? { ...e, ...fields(input) } : e));
    return Promise.resolve({ ok: true, value: events.find((e) => e.eventId === id) ?? null });
  },
  onCancel: (id: string): Promise<MutationResult> => {
    events = events.map((e) => (e.eventId === id ? { ...e, cancelled: true } : e));
    return Promise.resolve({ ok: true, value: null });
  },
  onStar: (id: string, starred: boolean): Promise<MutationResult> => {
    events = events.map((e) =>
      e.eventId === id ? { ...e, viewerStarred: starred, starCount: Math.max(0, e.starCount + (starred ? 1 : -1)) } : e,
    );
    return Promise.resolve({ ok: true, value: null });
  },
};

/** Injectable props for <LeaveCrew> so the flow is visible/testable on web. */
export const mockLeaveProps = {
  isTelegram: true,
  onLeave: (_cancelOwnEvents: boolean): Promise<MutationResult> => Promise.resolve({ ok: true, value: null }),
};

/** Seed the shared crew store with the mock roster (Crew list + also-going + picker). */
export function installCrewMock(): void {
  __setCrewLoader(() => Promise.resolve({ kind: 'ok', roster: MOCK_ROSTER }));
  refreshCrew();
}
