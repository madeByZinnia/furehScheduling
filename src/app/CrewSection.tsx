import { useState, useEffect } from 'preact/hooks';
import {
  fetchRoster,
  type Roster,
  type RosterResult,
  type RosterEntry,
  type RosterPlan,
} from './crewSync';
import { getTelegramSession } from './telegram-session';

/**
 * "Your crew" — who else is going to what. `load` resolves a {@link RosterResult}
 * whose four kinds map to four distinct, non-dead-end states:
 *  - non-telegram → a plain, non-error nudge to open in Telegram (no Retry).
 *  - ok + members → the crew list.
 *  - ok + empty roster → a distinct "no crew members yet" empty state (no Retry —
 *    it's a valid empty crew, not a failure).
 *  - error → a real failure message + a Retry button.
 * Previously all of these collapsed to `null`/"empty", which hid the error+Retry
 * state entirely and mislabelled failures as "Open in Telegram".
 *
 * Cognitive-a11y: every state is shape + text, never colour alone. A ghost crew
 * member is shown present-but-redacted with the literal words "no plans listed"
 * — we NEVER render a ghost member's plans, even if the payload smuggles some in.
 * `load` is injectable for tests; the default pulls the real roster for the boot
 * Telegram session.
 */
type LoadFn = () => Promise<RosterResult>;

const defaultLoad: LoadFn = () => fetchRoster(getTelegramSession());

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; roster: Roster }
  | { kind: 'non-telegram' } // plain web — no signed identity
  | { kind: 'empty' } // valid Telegram roster with no crew members
  | { kind: 'error' };

function planLabel(plan: RosterPlan): string {
  if (plan.title !== undefined && plan.title !== '') {
    return plan.start !== undefined && plan.start !== ''
      ? `${plan.title} — ${plan.start}`
      : plan.title;
  }
  return plan.occurrenceId;
}

function MemberPlans({ member }: { member: RosterEntry }) {
  if (member.ghost) {
    return <p class="crew-member-note">no plans listed</p>;
  }
  if (member.plans.length === 0) {
    return <p class="crew-member-note">no sessions starred yet</p>;
  }
  return (
    <ul class="crew-member-plans">
      {member.plans.map((plan) => (
        <li key={plan.occurrenceId}>{planLabel(plan)}</li>
      ))}
    </ul>
  );
}

function CrewList({ roster }: { roster: Roster }) {
  return (
    <ul class="crew-list">
      {roster.map((member) => (
        <li key={member.userId} class="crew-member">
          <span class="crew-member-name">{member.displayName}</span>
          <MemberPlans member={member} />
        </li>
      ))}
    </ul>
  );
}

export function CrewSection({ load = defaultLoad }: { load?: LoadFn }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void load().then(
      (result) => {
        if (!active) return;
        if (result.kind === 'non-telegram') {
          setState({ kind: 'non-telegram' });
        } else if (result.kind === 'error') {
          setState({ kind: 'error' });
        } else if (result.roster.length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', roster: result.roster });
        }
      },
      () => {
        if (active) setState({ kind: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [load, attempt]);

  return (
    <section class="crew-section" aria-labelledby="crew-section-heading">
      <h2 id="crew-section-heading">Your crew</h2>

      {state.kind === 'loading' && <p class="crew-status">Loading crew…</p>}

      {state.kind === 'non-telegram' && (
        <p class="crew-status">Open in Telegram to see your crew.</p>
      )}

      {state.kind === 'empty' && (
        <p class="crew-status">No crew members yet.</p>
      )}

      {state.kind === 'error' && (
        <>
          <p class="crew-status">Couldn’t load the crew right now.</p>
          <button
            type="button"
            class="crew-retry"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </>
      )}

      {state.kind === 'ready' && <CrewList roster={state.roster} />}
    </section>
  );
}
