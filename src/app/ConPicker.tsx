import { CONS, type ConId } from '../data/cons';
import { setActiveCon } from './con';

/**
 * Cold-start con chooser. Shown only when NO con could be resolved at boot — a
 * solo web visitor with no `?con=`, no Telegram start_param, and no stored
 * last-con. The common paths resolve synchronously at boot (see con.ts), so this
 * is the sole fallback rather than a routine screen.
 *
 * Picking NAVIGATES to `?con=<id>` (a full reload) rather than switching in
 * process. This is deliberate: the per-con stores (stars/ghost/profile) bind
 * their localStorage key ONCE at module-eval via conKey(); an in-process switch
 * would leave them on the boot-time `fureh.*` fallback namespace, so a fresh
 * visitor picking ToS would star into `fureh.*`. Reloading re-evaluates the whole
 * module graph with the chosen con resolved, so every store binds the correct
 * namespace and no stale schedule can flash under the new branding.
 */
function choose(id: ConId): void {
  setActiveCon(id); // persist app.lastCon.v1 (so a bare reload also resolves it)
  // Navigate with the explicit, highest-priority ?con= so the reload is unambiguous.
  window.location.search = `?con=${encodeURIComponent(id)}`;
}

export function ConPicker() {
  return (
    <main class="app con-picker">
      <header class="app-head">
        <h1>Choose your con</h1>
      </header>
      <ul class="con-picker-list" role="list">
        {Object.values(CONS).map((con) => (
          <li key={con.id}>
            <button type="button" class="con-picker-btn" onClick={() => choose(con.id)}>
              {con.name}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
