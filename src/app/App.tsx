import './app.css';
import { useState } from 'preact/hooks';
import scheduleJson from '../data/schedule.json';
import type { Schedule } from '../data/expand';
import { DisplaySettings } from './DisplaySettings';
import { GhostToggle } from './GhostToggle';
import { MeExport } from './MeExport';
import { MeImport } from './MeImport';
import { CrewSection } from './CrewSection';
import { EventsPanel } from './events/EventsPanel';
import { LeaveCrew } from './LeaveCrew';
import { ScheduleView } from './schedule/ScheduleView';
import { BottomNav } from './nav/BottomNav';
import type { Tab } from './nav/tabs';

const schedule = scheduleJson as Schedule;

/**
 * Three top-level views behind a bottom nav. Only the active view is mounted:
 * this keeps the schedule-local "jump to now" FAB (position:fixed) from bleeding
 * onto other tabs, and lets each view own its ephemeral state without a router.
 */
export function App() {
  const [tab, setTab] = useState<Tab>('schedule');

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

      {tab === 'crew' && (
        <>
          <EventsPanel />
          <CrewSection />
        </>
      )}

      {tab === 'me' && (
        <>
          <DisplaySettings />
          <GhostToggle />
          <MeExport occurrences={schedule.occurrences} />
          <MeImport occurrences={schedule.occurrences} />
          <LeaveCrew />
        </>
      )}

      <BottomNav active={tab} onSelect={setTab} />
    </main>
  );
}
