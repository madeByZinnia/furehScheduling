import { useGhost, setGhost } from './ghost';

/**
 * Ghost mode toggle — a single accessible checkbox that flips the persisted
 * per-device ghost flag (default OFF).
 *
 * Cognitive-a11y: a real <label> wraps the native checkbox so the whole row is a
 * hit target and screen readers announce the control by its name. State is
 * carried by the checkbox + label text (never colour alone). Plain-language help
 * spells out exactly what changes when it's on, so it's never a mystery switch.
 */
export function GhostToggle() {
  const ghost = useGhost();

  return (
    <section class="ghost-toggle" aria-labelledby="ghost-toggle-heading">
      <h2 id="ghost-toggle-heading">Ghost mode</h2>

      <label class="ghost-toggle-row">
        <input
          type="checkbox"
          checked={ghost}
          onChange={(e) => setGhost((e.target as HTMLInputElement).checked)}
        />
        Ghost mode
      </label>

      <p class="ghost-toggle-help">
        Your stars still sync and your .ics still works, but the crew sees you as
        “no plans listed”.
      </p>
    </section>
  );
}
