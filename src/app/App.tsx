import './app.css';
import { useEffect, useState } from 'preact/hooks';
import type { Schedule } from '../data/expand';
import { activeCon, useConId } from './con';
import { loadSchedule } from './schedule/load';
import { ConPicker } from './ConPicker';
import { DisplaySettings } from './DisplaySettings';
import { DisplayNameSetting } from './DisplayNameSetting';
import { GhostToggle } from './GhostToggle';
import { MeExport } from './MeExport';
import { MeImport } from './MeImport';
import { AboutDev } from './AboutDev';
import { CrewSection } from './CrewSection';
import { EventsPanel } from './events/EventsPanel';
import { LeaveCrew } from './LeaveCrew';
import { ScheduleView } from './schedule/ScheduleView';
import { MapView } from './map/MapView';
import { BottomNav } from './nav/BottomNav';
import type { Tab } from './nav/tabs';
import { mockEnabled, mockEventsProps, mockLeaveProps } from './devMock';

/**
 * Top-level views behind a bottom nav. Only the active view is mounted: this
 * keeps the schedule-local "jump to now" FAB (position:fixed) from bleeding onto
 * other tabs, and lets each view own its ephemeral state without a router.
 *
 * The active con drives everything: its schedule is loaded at runtime (not baked)
 * and its name brands the header. When NO con resolved at boot we show the
 * cold-start <ConPicker> instead of the app body.
 */
export function App() {
  const conId = useConId();
  const con = activeCon();
  const [tab, setTab] = useState<Tab>('schedule');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // DEV-only `?mock`: inject in-memory event/leave handlers so the Crew + Me UI
  // works without Telegram. Inert (false) in production builds.
  const mock = mockEnabled();

  // Load the ACTIVE con's schedule at runtime. Re-runs when the con changes (the
  // cold-start picker path). `cancelled` guards a con switch that outraces a
  // slow fetch so a stale response never lands.
  useEffect(() => {
    // Don't load a fallback schedule while unresolved — the picker is showing and
    // con.id is only the fureh default. (Picking navigates to ?con=, reloading.)
    if (!conId) return;
    let cancelled = false;
    setSchedule(null);
    setError(null);
    loadSchedule(con.id)
      .then((s) => {
        if (!cancelled) setSchedule(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, [con.id, conId]);

  // No con resolved at boot (solo web, no ?con / start_param / stored con): the
  // visitor must choose before anything else renders.
  if (!conId) return <ConPicker />;

  const body = error ? (
    <p class="empty">Could not load the schedule. Please try again later.</p>
  ) : !schedule ? (
    <p class="empty">Loading schedule…</p>
  ) : (
    <>
      {tab === 'schedule' &&
        (schedule.occurrences.length === 0 ? (
          <p class="empty">
            No schedule data. Run <code>npm run schedule</code>.
          </p>
        ) : (
          <ScheduleView occurrences={schedule.occurrences} />
        ))}

      {tab === 'map' && <MapView occurrences={schedule.occurrences} />}

      {tab === 'crew' && (
        <>
          <EventsPanel {...(mock ? mockEventsProps : {})} />
          <CrewSection />
        </>
      )}

      {tab === 'me' && (
        <>
          <DisplayNameSetting />
          <DisplaySettings />
          <GhostToggle />
          <MeExport occurrences={schedule.occurrences} />
          <MeImport occurrences={schedule.occurrences} />
          <LeaveCrew {...(mock ? mockLeaveProps : {})} />
          <AboutDev />
        </>
      )}
    </>
  );

  return (
    <main class="app">
      <header class="app-head">
        <h1>{con.name}</h1>
      </header>

      {body}

      <BottomNav active={tab} onSelect={setTab} />
    </main>
  );
}
