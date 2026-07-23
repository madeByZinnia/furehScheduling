import { useState } from 'preact/hooks';
import type { Occurrence } from '../data/expand';
import { activeCon } from './con';
import { addStars } from './stars';
import { parseCodes, matchKnownCodes, type CodeMatch, type CodeParseMode } from './import';

/**
 * "Import favourites" — a manual paste importer for the Me area, con-aware.
 *
 * Two importable dialects (see src/data/cons.ts `favourites`):
 *   - `pretalx-paste` (Fureh): the user opens their favourites JSON on the
 *     pretalx site (`favourites.sourceUrl`), copies it, and pastes it here; we
 *     extract 6-char submission codes.
 *   - `cookie-paste` (ToS): the fav list lives in a `HOWL_24` browser cookie;
 *     the user runs `favourites.snippetHint` in their console on the con site to
 *     copy the cookie VALUE (e.g. `2,3,17`) and pastes it here; we extract the
 *     numeric activity ids.
 *   - `none` (Canfurence): no importer at all — a short note, never a broken box.
 *
 * Why paste and not fetch: the favourites data is behind the con's own cookie /
 * credentials, so the browser can't read it cross-origin. Matching is fully local
 * (matchKnownCodes drops any token not in this schedule), so over-matching is
 * harmless: unknown tokens are simply ignored.
 *
 * Cognitive-a11y: one primary action per step, plain language, a real <label> on
 * the textarea, and never a dead-end — every step has a way back. Steps:
 *   1. paste   → instructions + textarea + Match
 *   2. confirm → counts + scrollable matched-title list + Import / start over
 *   3. done    → success count + import more
 */

type Step =
  | { kind: 'paste' }
  | { kind: 'confirm'; match: CodeMatch }
  | { kind: 'done'; count: number };

/** Open a URL, preferring the Telegram WebApp bridge when present. */
function openUrl(url: string): void {
  const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } })
    .Telegram?.WebApp;
  if (typeof tg?.openLink === 'function') {
    tg.openLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function PasteBox({
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

/** Fureh (pretalx) paste step: a link out to the favourites JSON, then the box. */
function PretalxPasteStep({
  sourceUrl,
  text,
  setText,
  onMatch,
}: {
  sourceUrl: string;
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
      <button type="button" class="me-link" onClick={() => openUrl(sourceUrl)}>
        <span aria-hidden="true">↗</span> Open my fur-eh favourites
      </button>

      <PasteBox text={text} setText={setText} onMatch={onMatch} />
    </>
  );
}

/** ToS (cookie) paste step: the console snippet to copy the cookie, then the box. */
function CookiePasteStep({
  snippetHint,
  text,
  setText,
  onMatch,
}: {
  snippetHint: string;
  text: string;
  setText: (v: string) => void;
  onMatch: () => void;
}) {
  return (
    <>
      <p class="me-hint">
        Your favourites live in a cookie on the con website. Open the site, then
        run this in your browser console to copy the value (something like{' '}
        <code>2,3,17</code>) and paste it below:
      </p>
      <pre class="me-snippet">{snippetHint}</pre>

      <PasteBox text={text} setText={setText} onMatch={onMatch} />
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
  const fav = activeCon().favourites;
  const [text, setText] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'paste' });

  // Canfurence (and any 'none' con): no favourites source — show a note, never a
  // broken importer. Hooks above run unconditionally so order stays stable.
  if (fav.mode === 'none') {
    return (
      <section class="me-import" aria-labelledby="me-import-heading">
        <h2 id="me-import-heading">Import favourites</h2>
        <p class="me-note">This con has no favourites to import.</p>
      </section>
    );
  }

  const parseMode: CodeParseMode =
    fav.mode === 'cookie-paste' ? 'cookie-paste' : 'pretalx-paste';
  // Scope numeric extraction to this cookie's value so a pasted raw cookie
  // string can't star a code that collides with the cookie NAME (e.g. 24).
  const cookieName = fav.mode === 'cookie-paste' ? fav.cookieName : undefined;

  const onMatch = () => {
    setStep({
      kind: 'confirm',
      match: matchKnownCodes(parseCodes(text, parseMode, cookieName), occurrences),
    });
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
      <h2 id="me-import-heading">Import favourites</h2>

      {step.kind === 'paste' &&
        (fav.mode === 'cookie-paste' ? (
          <CookiePasteStep
            snippetHint={fav.snippetHint}
            text={text}
            setText={setText}
            onMatch={onMatch}
          />
        ) : (
          <PretalxPasteStep
            sourceUrl={fav.sourceUrl}
            text={text}
            setText={setText}
            onMatch={onMatch}
          />
        ))}
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
