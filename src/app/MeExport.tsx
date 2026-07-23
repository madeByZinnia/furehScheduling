import { useState } from 'preact/hooks';
import type { Occurrence } from '../data/expand';
import { activeCon } from './con';
import { useStars } from './stars';
import { buildStarredIcs, downloadIcs, selectStarredOccurrences } from './export';

/**
 * "My schedule" — a client-only .ics export of the user's starred sessions.
 *
 * Cognitive-a11y choices: one obvious primary action (icon + text, never
 * icon-only), a real <label> tying the reminder checkbox to its control, and the
 * reminder is opt-IN (unchecked → no VALARM). At 0 stars the button is disabled
 * with a plain-language hint instead of producing an empty file. Generation is
 * fully local; the copy says so.
 */
export function MeExport({ occurrences }: { occurrences: Occurrence[] }) {
  const stars = useStars();
  const [remind, setRemind] = useState(false);
  // Count/enable from the intersection of stars and the CURRENT schedule, not
  // stars.size — a starred id that's no longer in the schedule must not inflate
  // the count or enable a Download that would yield an empty file (no dead-ends).
  const selected = selectStarredOccurrences(stars, occurrences);
  const count = selected.length;
  const empty = count === 0;

  const onDownload = () => {
    // Build from the CURRENT stars + schedule at click time, branded per active con.
    const { prodId, uidDomain, filename } = activeCon().ics;
    const ics = buildStarredIcs(stars, occurrences, {
      prodId,
      uidDomain,
      ...(remind ? { alarm: true } : {}),
    });
    downloadIcs(filename, ics);
  };

  return (
    <section class="me-export" aria-labelledby="me-export-heading">
      <h2 id="me-export-heading">My schedule</h2>
      <p class="me-count">
        {count === 1 ? '1 session starred' : `${count} sessions starred`}
      </p>

      <label class="me-remind">
        <input
          type="checkbox"
          checked={remind}
          disabled={empty}
          onChange={(e) => setRemind((e.target as HTMLInputElement).checked)}
        />
        Remind me 10 minutes before
      </label>

      <button
        type="button"
        class="me-download"
        onClick={onDownload}
        disabled={empty}
      >
        <span aria-hidden="true">📅</span> Download .ics
      </button>

      {empty && (
        <p class="me-hint">Star sessions on the schedule to add them here.</p>
      )}

      <p class="me-note">Built on your device — nothing is uploaded.</p>
    </section>
  );
}
