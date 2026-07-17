import { useEffect, useState } from 'preact/hooks';
import { getTelegramSession } from '../telegram-session';
import {
  listEvents,
  createEvent,
  editEvent,
  cancelEvent,
  starEvent,
  buildEventInput,
  formFromEvent,
  emptyForm,
  describeWhen,
  type EventView,
  type EventForm,
  type EventInput,
  type EventListResult,
  type MutationResult,
} from '../events';

/**
 * Custom crew events on the Crew tab: your own events (create / edit / cancel),
 * plus the rest of the crew's events (star only). One screen, two modes — a list
 * and a create/edit form (edit reopens the form pre-filled). No dead ends: the
 * form always has an explicit ✕ back, and cancelling an event is owner-only and
 * sits behind a "you sure" checkbox. Actions are injectable for tests.
 */

type Load = () => Promise<EventListResult>;
type Create = (input: EventInput) => Promise<MutationResult<EventView | null>>;
type Edit = (eventId: string, input: EventInput) => Promise<MutationResult<EventView | null>>;
type Cancel = (eventId: string) => Promise<MutationResult>;
type Star = (eventId: string, starred: boolean) => Promise<MutationResult>;

interface EventsPanelProps {
  load?: Load;
  onCreate?: Create;
  onEdit?: Edit;
  onCancel?: Cancel;
  onStar?: Star;
}

type ListState = EventListResult | { kind: 'loading' };
type Mode = { kind: 'list' } | { kind: 'form'; editing: EventView | null };

function messageFor(res: Extract<MutationResult, { ok: false }>): string {
  switch (res.reason) {
    case 'not-owner':
      return 'Only the owner can change this event.';
    case 'invalid':
      return res.message ?? 'Please check the fields and try again.';
    case 'non-telegram':
      return 'Open in Telegram to do this.';
    case 'error':
      return 'Something went wrong — please try again.';
  }
}

export function EventsPanel({
  load = () => listEvents(getTelegramSession()),
  onCreate = (input) => createEvent(getTelegramSession(), input),
  onEdit = (id, input) => editEvent(getTelegramSession(), id, input),
  onCancel = (id) => cancelEvent(getTelegramSession(), id),
  onStar = (id, starred) => starEvent(getTelegramSession(), id, starred),
}: EventsPanelProps) {
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void load().then(
      (r) => active && setState(r),
      () => active && setState({ kind: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [load, attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const backToList = () => {
    setError(null);
    setMode({ kind: 'list' });
  };

  const submit = async (form: EventForm): Promise<void> => {
    setBusy(true);
    setError(null);
    const input = buildEventInput(form);
    const editing = mode.kind === 'form' ? mode.editing : null;
    const res = editing ? await onEdit(editing.eventId, input) : await onCreate(input);
    setBusy(false);
    if (res.ok) {
      backToList();
      reload();
    } else {
      setError(messageFor(res));
    }
  };

  const doCancel = async (ev: EventView): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await onCancel(ev.eventId);
    setBusy(false);
    if (res.ok) {
      backToList();
      reload();
    } else {
      setError(messageFor(res));
    }
  };

  const toggleStar = async (ev: EventView): Promise<void> => {
    const res = await onStar(ev.eventId, !ev.viewerStarred);
    if (res.ok) reload();
  };

  return (
    <section class="events-section" aria-labelledby="events-heading">
      <h2 id="events-heading" class="events-title">
        Crew events
      </h2>
      {mode.kind === 'form' ? (
        <CreateEditForm
          key={mode.editing?.eventId ?? 'new'}
          initial={mode.editing ? formFromEvent(mode.editing) : emptyForm()}
          isEdit={mode.editing !== null}
          canCancel={mode.editing !== null && mode.editing.isOwner && !mode.editing.cancelled}
          busy={busy}
          error={error}
          onSubmit={(form) => void submit(form)}
          onCancelEvent={() => mode.editing && void doCancel(mode.editing)}
          onBack={backToList}
        />
      ) : (
        <ListView
          state={state}
          onNew={() => {
            setError(null);
            setMode({ kind: 'form', editing: null });
          }}
          onEdit={(ev) => {
            setError(null);
            setMode({ kind: 'form', editing: ev });
          }}
          onStar={(ev) => void toggleStar(ev)}
          onRetry={reload}
        />
      )}
    </section>
  );
}

function ListView({
  state,
  onNew,
  onEdit,
  onStar,
  onRetry,
}: {
  state: ListState;
  onNew: () => void;
  onEdit: (ev: EventView) => void;
  onStar: (ev: EventView) => void;
  onRetry: () => void;
}) {
  if (state.kind === 'loading') return <p class="events-status">Loading events…</p>;
  if (state.kind === 'non-telegram')
    return <p class="events-status">Open in Telegram to see and add crew events.</p>;
  if (state.kind === 'error')
    return (
      <>
        <p class="events-status">Couldn’t load events.</p>
        <button type="button" class="event-retry" onClick={onRetry}>
          Retry
        </button>
      </>
    );

  const mine = state.events.filter((e) => e.isOwner);
  const others = state.events.filter((e) => !e.isOwner);
  return (
    <>
      <div class="events-head">
        <h3>Your events</h3>
        <button type="button" class="event-new" onClick={onNew}>
          ＋ New event
        </button>
      </div>
      {mine.length === 0 ? (
        <p class="events-empty">You haven’t added any events yet.</p>
      ) : (
        <ul class="events-list">
          {mine.map((ev) => (
            <EventCard key={ev.eventId} ev={ev} onStar={onStar} onEdit={onEdit} />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <>
          <h3 class="events-subhead">Other crew events</h3>
          <ul class="events-list">
            {others.map((ev) => (
              <EventCard key={ev.eventId} ev={ev} onStar={onStar} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function EventCard({
  ev,
  onStar,
  onEdit,
}: {
  ev: EventView;
  onStar: (ev: EventView) => void;
  onEdit?: (ev: EventView) => void;
}) {
  const when = describeWhen(ev);
  return (
    <li class={`event-card${ev.cancelled ? ' is-cancelled' : ''}`}>
      <div class="event-card-body">
        <div class="event-card-title">
          {ev.cancelled && <span class="event-cancelled-tag">[CANCELLED]</span>} {ev.title}
        </div>
        {when !== null && <div class="event-card-when">{when}</div>}
        {ev.location !== null && <div class="event-card-loc">{ev.location}</div>}
        {ev.notes !== null && <div class="event-card-notes">{ev.notes}</div>}
        {onEdit !== undefined && ev.isOwner && !ev.cancelled && (
          <button type="button" class="event-edit" onClick={() => onEdit(ev)}>
            ✎ Edit event
          </button>
        )}
      </div>
      <button
        type="button"
        class="event-star"
        aria-pressed={ev.viewerStarred}
        aria-label={ev.viewerStarred ? `Unstar ${ev.title}` : `Star ${ev.title}`}
        onClick={() => onStar(ev)}
      >
        <span aria-hidden="true">{ev.viewerStarred ? '★' : '☆'}</span>
        <span class="event-star-count">{ev.starCount}</span>
      </button>
    </li>
  );
}

function TextField({
  label,
  opt,
  value,
  onValue,
  placeholder,
  textarea,
}: {
  label: string;
  opt?: string;
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  return (
    <label class="field">
      <span class="field-label">
        {label}
        {opt !== undefined && <span class="field-opt"> {opt}</span>}
      </span>
      {textarea === true ? (
        <textarea
          class="field-input field-textarea"
          value={value}
          onInput={(e) => onValue(e.currentTarget.value)}
        />
      ) : (
        <input
          class="field-input"
          value={value}
          placeholder={placeholder}
          onInput={(e) => onValue(e.currentTarget.value)}
        />
      )}
    </label>
  );
}

function CreateEditForm({
  initial,
  isEdit,
  canCancel,
  busy,
  error,
  onSubmit,
  onCancelEvent,
  onBack,
}: {
  initial: EventForm;
  isEdit: boolean;
  canCancel: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (form: EventForm) => void;
  onCancelEvent: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState<EventForm>(initial);
  const set = (patch: Partial<EventForm>) => setForm((f) => ({ ...f, ...patch }));
  const titleEmpty = form.title.trim() === '';

  return (
    <div class="event-form">
      <div class="event-form-head">
        <h3>{isEdit ? 'Edit event' : 'Add an event'}</h3>
        <button type="button" class="event-back" onClick={onBack}>
          ✕ Cancel
        </button>
      </div>

      {error !== null && (
        <p class="event-error" role="alert">
          {error}
        </p>
      )}

      <TextField
        label="What"
        value={form.title}
        onValue={(v) => set({ title: v })}
        placeholder="Room party — Rm 1412"
      />

      <TextField
        label="Where"
        opt="free text — e.g. a room number"
        value={form.location}
        onValue={(v) => set({ location: v })}
        placeholder="Rm 1412 · Wyndham 14th floor"
      />

      <div class="field">
        <span class="field-label">
          When <span class="field-opt">optional</span>
        </span>
        <div class="field-when">
          <input
            type="date"
            class="field-input"
            aria-label="Day"
            value={form.day}
            onInput={(e) => set({ day: e.currentTarget.value })}
          />
          <input
            type="time"
            class="field-input"
            aria-label="Start time"
            value={form.startTime}
            onInput={(e) => set({ startTime: e.currentTarget.value })}
          />
          <span class="field-when-sep" aria-hidden="true">
            –
          </span>
          <input
            type="time"
            class="field-input"
            aria-label="End time"
            value={form.endTime}
            onInput={(e) => set({ endTime: e.currentTarget.value })}
          />
        </div>
      </div>

      <TextField
        label="Notes"
        opt="optional"
        value={form.notes}
        onValue={(v) => set({ notes: v })}
        textarea
      />

      <button
        type="button"
        class="btn-primary"
        disabled={busy || titleEmpty}
        onClick={() => onSubmit(form)}
      >
        {isEdit ? 'Save changes' : 'Add to crew schedule'}
      </button>

      {canCancel && <CancelSection busy={busy} onConfirm={onCancelEvent} />}
    </div>
  );
}

function CancelSection({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <div class="event-cancel">
      <h4 class="events-subhead">Cancel this event</h4>
      <p class="event-note">
        Cancelling shows <b>[CANCELLED]</b> to everyone who starred it — it doesn’t silently
        vanish.
      </p>
      <label class="check">
        <input
          type="checkbox"
          checked={sure}
          onChange={(e) => setSure(e.currentTarget.checked)}
        />
        <span>Yes, I’m sure — cancel it</span>
      </label>
      <button type="button" class="btn-danger" disabled={busy || !sure} onClick={onConfirm}>
        Cancel event
      </button>
    </div>
  );
}
