import './app.css';
import { useState } from 'preact/hooks';
import scheduleJson from '../data/schedule.json';
import type { Schedule } from '../data/expand';
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

const schedule = scheduleJson as Schedule;

/**
 * Top-level views behind a bottom nav. Only the active view is mounted: this
 * keeps the schedule-local "jump to now" FAB (position:fixed) from bleeding onto
 * other tabs, and lets each view own its ephemeral state without a router.
 */
export function App() {
  const [tab, setTab] = useState<Tab>('schedule');
  // DEV-only `?mock`: inject in-memory event/leave handlers so the Crew + Me UI
  // works without Telegram. Inert (false) in production builds.
  const mock = mockEnabled();

  return (
    <main class="app">
      <header class="app-head">
        <h1>Fur-Eh 2026</h1>
      </header>

      {tab === 'schedule' &&
        (schedule.occurrences.length === 0 ? (
          <p class="empty">
            No schedule data. Run <code>npm run schedule</code>.
          </p>
        ) : (
          <ScheduleView occurrences={schedule.occurrences} />
        ))}

      {tab === 'map' && <MapView />}

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

      <BottomNav active={tab} onSelect={setTab} />
    </main>
  );
}
