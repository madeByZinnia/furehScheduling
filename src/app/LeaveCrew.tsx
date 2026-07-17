import { useState } from 'preact/hooks';
import { getTelegramSession } from './telegram-session';
import { suspendAutoSync } from './crewSync';
import { leaveCrew, type MutationResult } from './events';

/**
 * Leave-crew flow (Me › Privacy). Leaving is PURE PRIVACY — it removes you from
 * the roster so your plans stop being shared. The "also cancel events I created"
 * box MUST default UNCHECKED (bgx.1): a privacy action must never destroy other
 * people's starred plans by default. Only rendered inside Telegram (there is no
 * crew to leave on plain web). Action injectable for tests.
 */

type Leave = (cancelOwnEvents: boolean) => Promise<MutationResult>;

export function LeaveCrew({
  onLeave = (cancelOwnEvents) => leaveCrew(getTelegramSession(), cancelOwnEvents),
  isTelegram = getTelegramSession().isTelegram,
}: {
  onLeave?: Leave;
  isTelegram?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cancelOwn, setCancelOwn] = useState(false); // bgx.1: defaults unchecked
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'done' | 'error'>('idle');

  if (!isTelegram) return null;

  // Each confirmation starts fresh: the destructive "also cancel my events" box
  // must never carry over a previous tick (bgx.1 — default unchecked, every time).
  const openConfirm = () => {
    setCancelOwn(false);
    setStatus('idle');
    setOpen(true);
  };
  const dismiss = () => {
    setCancelOwn(false);
    setOpen(false);
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setStatus('idle');
    const res = await onLeave(cancelOwn);
    setBusy(false);
    if (res.ok) {
      // Stop auto-sync so a later star/ghost change can't silently re-add us.
      suspendAutoSync();
      setOpen(false);
      setStatus('done');
    } else {
      setStatus('error');
    }
  };

  if (status === 'done') {
    return (
      <section class="leave-section">
        <p class="crew-status" role="status">
          You’ve left the crew. Your plans are no longer shared.
        </p>
      </section>
    );
  }

  return (
    <section class="leave-section" aria-labelledby="leave-heading">
      <h3 id="leave-heading" class="events-subhead">
        Leave crew
      </h3>
      {!open ? (
        <button type="button" class="btn-danger" onClick={openConfirm}>
          Leave crew &amp; stop sharing
        </button>
      ) : (
        <div class="leave-confirm">
          <p class="event-note">
            Leaving removes you from the crew roster — your starred plans stop being shared. The
            events you created stay unless you tick the box below.
          </p>
          <label class="check">
            <input
              type="checkbox"
              checked={cancelOwn}
              onChange={(e) => setCancelOwn(e.currentTarget.checked)}
            />
            <span>Also cancel events I created</span>
          </label>
          {status === 'error' && (
            <p class="event-error" role="alert">
              Couldn’t leave right now — please try again.
            </p>
          )}
          <div class="leave-actions">
            <button type="button" class="event-back" onClick={dismiss}>
              ✕ Keep me in
            </button>
            <button type="button" class="btn-danger" disabled={busy} onClick={() => void confirm()}>
              Leave crew
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
