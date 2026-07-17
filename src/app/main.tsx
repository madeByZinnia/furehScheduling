import './a11y.css'; // MUST be first — a11y baseline before any component styles
import { render } from 'preact';
import { App } from './App';
import { configureNow } from './now';
import { initSettings } from './settings';

configureNow(); // apply ?now= override before anything reads "now"
initSettings(); // apply persisted theme + text size to <html>

const root = document.getElementById('app');
if (!root) throw new Error('#app root element missing');
render(<App />, root);
