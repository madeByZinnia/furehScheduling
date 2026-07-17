import './a11y.css'; // MUST be first — a11y baseline before any component styles
import { render } from 'preact';
import { App } from './App';
import { configureNow } from './now';
import { initSettings } from './settings';
import { startAutoSync } from './crewSync';
import { startCrewAutoRefresh } from './crew';
import { mockEnabled, installCrewMock } from './devMock';

configureNow(); // apply ?now= override before anything reads "now"
initSettings(); // apply persisted theme + text size to <html>

// DEV-only: `?mock` seeds the crew store with fake data so the crew + events UI
// can be exercised in a plain browser. Inert in production (see devMock.ts).
if (mockEnabled()) installCrewMock();

// Start crew auto-sync ONCE at boot. This also imports telegram-session eagerly
// at entry, so the launch hash is captured before any later URL mutation. It's a
// no-op on plain web (no signed identity), so this is safe everywhere. The
// subscription lives for the app's lifetime; the unsubscribe is intentionally
// dropped.
startAutoSync();
// Re-pull the shared crew roster whenever this device's sync lands, so the
// member list and the schedule's "also going" chips stay fresh. Lifetime
// subscription; unsubscribe intentionally dropped.
startCrewAutoRefresh();

const root = document.getElementById('app');
if (!root) throw new Error('#app root element missing');
render(<App />, root);
