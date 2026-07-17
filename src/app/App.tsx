import './app.css';
import scheduleJson from '../data/schedule.json';
import type { Schedule } from '../data/expand';
import { isTimeTravelling } from './now';
import { useNow } from './useNow';
import { formatTime } from './datetime';
import { DisplaySettings } from './DisplaySettings';
import { MeExport } from './MeExport';
import { ScheduleView } from './schedule/ScheduleView';
import { useStars } from './stars';

const schedule = scheduleJson as Schedule;

export function App() {
  const stars = useStars();
  const when = formatTime(useNow().toISOString());

  return (
    <main class="app">
      <header class="app-head">
        <h1>Fur-Eh 2026</h1>
        <span class="when">
          {isTimeTravelling() ? `⏱ ${when}` : when} · {stars.size} starred
        </span>
      </header>

      <DisplaySettings />

      <MeExport occurrences={schedule.occurrences} />

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
