import './a11y.css'; // MUST be first — a11y baseline before any component styles
import { render } from 'preact';
import { App } from './App';
import { configureNow } from './now';
import { initSettings } from './settings';
import { startAutoSync } from './crewSync';

configureNow(); // apply ?now= override before anything reads "now"
initSettings(); // apply persisted theme + text size to <html>

// Start crew auto-sync ONCE at boot. This also imports telegram-session eagerly
// at entry, so the launch hash is captured before any later URL mutation. It's a
// no-op on plain web (no signed identity), so this is safe everywhere. The
// subscription lives for the app's lifetime; the unsubscribe is intentionally
// dropped.
startAutoSync();

const root = document.getElementById('app');
if (!root) throw new Error('#app root element missing');
render(<App />, root);
