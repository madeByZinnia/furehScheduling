import { useCrew, refreshCrew } from './crew';
import type { Roster, RosterEntry } from './crewSync';
import { Avatar } from './Avatar';

/**
 * "Your crew" — the roster of who's in your group. A compact people-overview:
 * avatar, name, and either a star count (non-ghost) or the ghost badge. The
 * per-session "who's going to what" now lives on the Schedule tab (the "also
 * going" chips + the whose-favourites picker), so this stays a clean list.
 *
 * Cognitive-a11y: every state is shape + text, never colour alone. A ghost member
 * is shown present-but-redacted with the literal words "Ghost mode" and NO star
 * count — we never reveal what (or how much) a ghost starred. Roster data comes
 * from the shared crew store (one fetch, shared with the Schedule tab).
 */

function MemberStatus({ member }: { member: RosterEntry }) {
  if (member.ghost) {
    return <p class="crew-member-note">👻 Ghost mode</p>;
  }
  if (member.plans.length === 0) {
    return <p class="crew-member-note">No sessions starred yet</p>;
  }
  return null;
}

function MemberRow({ member }: { member: RosterEntry }) {
  return (
    <li class="crew-member">
      <Avatar userId={member.userId} name={member.displayName} />
      <div class="crew-member-main">
        <span class="crew-member-name">{member.displayName}</span>
        <MemberStatus member={member} />
      </div>
      {/* No count for ghosts — never reveal a ghost's star count. */}
      {!member.ghost && member.plans.length > 0 && (
        <span class="crew-member-count">
          {member.plans.length}
          <small>{member.plans.length === 1 ? 'star' : 'stars'}</small>
        </span>
      )}
    </li>
  );
}

function CrewList({ roster }: { roster: Roster }) {
  return (
    <ul class="crew-list">
      {roster.map((member) => (
        <MemberRow key={member.userId} member={member} />
      ))}
    </ul>
  );
}

export function CrewSection() {
  const crew = useCrew();

  return (
    <section class="crew-section" aria-labelledby="crew-section-heading">
      <div class="crew-head">
        <h2 id="crew-section-heading">Your crew</h2>
        {crew.kind === 'ok' && crew.roster.length > 0 && (
          <span class="crew-count-label">
            {crew.roster.length} {crew.roster.length === 1 ? 'member' : 'members'}
          </span>
        )}
      </div>

      {(crew.kind === 'idle' || crew.kind === 'loading') && (
        <p class="crew-status">Loading crew…</p>
      )}

      {crew.kind === 'non-telegram' && (
        <p class="crew-status">Open in Telegram to see your crew.</p>
      )}

      {crew.kind === 'error' && (
        <>
          <p class="crew-status">Couldn’t load the crew right now.</p>
          <button type="button" class="crew-retry" onClick={refreshCrew}>
            Retry
          </button>
        </>
      )}

      {crew.kind === 'ok' && crew.roster.length === 0 && (
        <>
          <p class="crew-status">No crew members yet.</p>
          <button type="button" class="crew-refresh" onClick={refreshCrew}>
            Refresh
          </button>
        </>
      )}

      {crew.kind === 'ok' && crew.roster.length > 0 && (
        <>
          <CrewList roster={crew.roster} />
          <button type="button" class="crew-refresh" onClick={refreshCrew}>
            Refresh
          </button>
        </>
      )}
    </section>
  );
}
