import './app.css';
import { useState } from 'preact/hooks';
import scheduleJson from '../data/schedule.json';
import type { Schedule } from '../data/expand';
import { DisplaySettings } from './DisplaySettings';
import { GhostToggle } from './GhostToggle';
import { MeExport } from './MeExport';
import { MeImport } from './MeImport';
import { CrewSection } from './CrewSection';
import { ScheduleView } from './schedule/ScheduleView';
import { MapView } from './map/MapView';

const schedule = scheduleJson as Schedule;

type View = 'schedule' | 'map';

export function App() {
  // Map is an experimental peer view (M4 spike) — isolated behind this toggle so
  // it never touches the schedule path and can be dropped without a trace.
  const [view, setView] = useState<View>('schedule');

  return (
    <main class="app">
      <header class="app-head">
        <h1>Fur-Eh 2026</h1>
      </header>

      <DisplaySettings />

      <div class="view-toggle" role="group" aria-label="Choose a view">
        <button
          type="button"
          class="view-tab"
          aria-pressed={view === 'schedule'}
          onClick={() => setView('schedule')}
        >
          Schedule
        </button>
        <button
          type="button"
          class="view-tab"
          aria-pressed={view === 'map'}
          onClick={() => setView('map')}
        >
          Map
        </button>
      </div>

      {view === 'map' ? (
        <MapView />
      ) : (
        <>
          <GhostToggle />

          <MeExport occurrences={schedule.occurrences} />

          <MeImport occurrences={schedule.occurrences} />

          <CrewSection />

          {schedule.occurrences.length === 0 ? (
            <p class="empty">
              No schedule data. Run <code>npm run schedule</code>.
            </p>
          ) : (
            <ScheduleView occurrences={schedule.occurrences} />
          )}
        </>
      )}
    </main>
  );
}
