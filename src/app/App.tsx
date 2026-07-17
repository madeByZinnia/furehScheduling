import './app.css';
import scheduleJson from '../data/schedule.json';
import type { Schedule } from '../data/expand';
import { DisplaySettings } from './DisplaySettings';
import { GhostToggle } from './GhostToggle';
import { MeExport } from './MeExport';
import { MeImport } from './MeImport';
import { CrewSection } from './CrewSection';
import { ScheduleView } from './schedule/ScheduleView';

const schedule = scheduleJson as Schedule;

export function App() {
  return (
    <main class="app">
      <header class="app-head">
        <h1>Fur-Eh 2026</h1>
      </header>

      <DisplaySettings />

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
    </main>
  );
}
