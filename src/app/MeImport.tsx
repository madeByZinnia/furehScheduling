import { useState } from 'preact/hooks';
import type { Occurrence } from '../data/expand';
import { addStars } from './stars';
import { parseCodes, matchKnownCodes, type CodeMatch } from './import';

/**
 * Where the user copies their favourites from. The fur-eh schedule runs on
 * pretalx at events.fureh.ca; the favourites (favs) endpoint returns the
 * logged-in user's starred submission codes as JSON, which the user select-all
 * + copies and pastes below. See import.ts for why this can't be fetched.
 *
 * TODO(4cz.8): confirm the exact favourites path against the live pretalx
 * install before launch. `/schedule/favs/` is the pretalx convention; if the
 * event uses a different route this constant is the single place to change.
 */
const FAVOURITES_URL = 'https://events.fureh.ca/2026/schedule/favs/';

/** Open a URL, preferring the Telegram WebApp bridge when present. */
function openFavourites(): void {
  const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } })
    .Telegram?.WebApp;
  if (typeof tg?.openLink === 'function') {
    tg.openLink(FAVOURITES_URL);
    return;
  }
  window.open(FAVOURITES_URL, '_blank', 'noopener,noreferrer');
}

type Step =
  | { kind: 'paste' }
  | { kind: 'confirm'; match: CodeMatch }
  | { kind: 'done'; count: number };

/**
 * "Import from fur-eh favourites" — a manual paste importer for the Me area.
 *
 * Cognitive-a11y: one primary action per step, plain language, a real <label>
 * on the textarea, and never a dead-end — every step has a way back. Steps:
 *   1. paste   → link out + textarea + Match
 *   2. confirm → counts + scrollable matched-title list + Import / start over
 *   3. done    → success count + import more
 * Over-matching is harmless: matchKnownCodes drops any token not in the
 * schedule, and importing stars ALL occurrences of each matched code.
 */
function PasteStep({
  text,
  setText,
  onMatch,
}: {
  text: string;
  setText: (v: string) => void;
  onMatch: () => void;
}) {
  return (
    <>
      <p class="me-hint">
        Star sessions on the fur-eh site, then copy your favourites and paste them
        below. We match them to this schedule for you.
      </p>
      <button type="button" class="me-link" onClick={openFavourites}>
        <span aria-hidden="true">↗</span> Open my fur-eh favourites
      </button>

      <label class="me-import-label" for="me-import-text">
        Paste your favourites here
      </label>
      <textarea
        id="me-import-text"
        class="me-import-text"
        rows={5}
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        placeholder="Paste the copied favourites text…"
      />

      <button
        type="button"
        class="me-download"
        onClick={onMatch}
        disabled={text.trim().length === 0}
      >
        Match
      </button>
    </>
  );
}

function ConfirmStep({
  match,
  onImport,
  restart,
}: {
  match: CodeMatch;
  onImport: () => void;
  restart: () => void;
}) {
  if (match.matched.length === 0) {
    return (
      <>
        <p class="me-count">
          No sessions matched. Check that you copied your favourites, then try
          again.
        </p>
        <button type="button" class="me-download" onClick={restart}>
          Start over
        </button>
      </>
    );
  }
  return (
    <>
      <p class="me-count">
        Found {match.matched.length + match.unknown.length} codes —{' '}
        {match.matched.length} matched
      </p>
      <ul class="me-import-titles">
        {match.titles.map((title) => (
          <li key={title}>{title}</li>
        ))}
      </ul>
      <div class="me-import-actions">
        <button type="button" class="me-download" onClick={onImport}>
          Import {match.matched.length}{' '}
          {match.matched.length === 1 ? 'session' : 'sessions'}
        </button>
        <button type="button" class="me-link" onClick={restart}>
          Cancel
        </button>
      </div>
    </>
  );
}

export function MeImport({ occurrences }: { occurrences: Occurrence[] }) {
  const [text, setText] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'paste' });

  const onMatch = () => {
    setStep({ kind: 'confirm', match: matchKnownCodes(parseCodes(text), occurrences) });
  };
  const onImport = (match: CodeMatch) => {
    addStars(match.occurrenceIds);
    setStep({ kind: 'done', count: match.matched.length });
  };
  const restart = () => {
    setText('');
    setStep({ kind: 'paste' });
  };

  return (
    <section class="me-import" aria-labelledby="me-import-heading">
      <h2 id="me-import-heading">Import from fur-eh favourites</h2>

      {step.kind === 'paste' && (
        <PasteStep text={text} setText={setText} onMatch={onMatch} />
      )}
      {step.kind === 'confirm' && (
        <ConfirmStep
          match={step.match}
          onImport={() => onImport(step.match)}
          restart={restart}
        />
      )}
      {step.kind === 'done' && (
        <>
          <p class="me-count">
            Imported — {step.count} {step.count === 1 ? 'session' : 'sessions'}{' '}
            starred.
          </p>
          <button type="button" class="me-link" onClick={restart}>
            Import more
          </button>
        </>
      )}

      <p class="me-note">Matched on your device — nothing is uploaded.</p>
    </section>
  );
}
