import { useMemo } from 'preact/hooks';
import scheduleJson from '../data/schedule.json';
import type { Schedule } from '../data/expand';
import { configureNow, now, isTimeTravelling } from './now';

configureNow();

const schedule = scheduleJson as Schedule;

const timeFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Edmonton',
  dateStyle: 'full',
  timeStyle: 'short',
});

export function App() {
  const current = useMemo(() => timeFmt.format(now()), []);
  const count = schedule.occurrences.length;

  return (
    <main style={{ padding: '1rem', maxWidth: '40rem', margin: '0 auto' }}>
      <h1>Fur-Eh 2026 Crew</h1>
      <p>
        {count > 0
          ? `${count} occurrences loaded.`
          : 'No schedule data yet — run `npm run schedule` to fetch and expand it.'}
      </p>
      <p>
        <strong>Now (America/Edmonton):</strong> {current}
        {isTimeTravelling() && (
          <span>
            {' '}
            — time-travelling via <code>?now=</code>
          </span>
        )}
      </p>
    </main>
  );
}
