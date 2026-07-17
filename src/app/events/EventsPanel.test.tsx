// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { EventView, EventListResult, MutationResult, EventInput } from '../events';
import { EventsPanel } from './EventsPanel';

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  render(null, container);
  container.remove();
});

function ev(over: Partial<EventView> = {}): EventView {
  return {
    eventId: 'e1',
    ownerId: 1,
    title: 'My Party',
    day: '2026-07-18',
    startIso: '2026-07-18T22:00',
    endIso: null,
    location: 'Rm 1412',
    notes: null,
    cancelled: false,
    starCount: 2,
    viewerStarred: false,
    isOwner: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const ok = <T,>(value: T): Promise<MutationResult<T>> => Promise.resolve({ ok: true, value });

interface Handlers {
  load?: () => Promise<EventListResult>;
  onCreate?: ReturnType<typeof vi.fn>;
  onEdit?: ReturnType<typeof vi.fn>;
  onCancel?: ReturnType<typeof vi.fn>;
  onStar?: ReturnType<typeof vi.fn>;
}

async function mount(h: Handlers): Promise<void> {
  await act(async () => {
    render(
      <EventsPanel
        load={h.load ?? (() => Promise.resolve({ kind: 'ok', events: [] }))}
        onCreate={h.onCreate ?? vi.fn(() => ok<EventView | null>(null))}
        onEdit={h.onEdit ?? vi.fn(() => ok<EventView | null>(null))}
        onCancel={h.onCancel ?? vi.fn(() => ok(null))}
        onStar={h.onStar ?? vi.fn(() => ok(null))}
      />,
      container,
    );
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const click = (el: Element | null) =>
  void act(() => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('EventsPanel — list', () => {
  it('splits your events (Edit shown) from others (star only); marks cancelled', async () => {
    await mount({
      load: () =>
        Promise.resolve({
          kind: 'ok',
          events: [
            ev({ eventId: 'm1', title: 'My Party', isOwner: true }),
            ev({ eventId: 'o1', title: 'Their Meetup', isOwner: false, viewerStarred: true }),
            ev({ eventId: 'c1', title: 'Old Thing', isOwner: true, cancelled: true }),
          ],
        }),
    });

    expect(container.textContent).toContain('My Party');
    expect(container.textContent).toContain('Their Meetup');
    expect(container.textContent).toContain('[CANCELLED]');

    const cards = container.querySelectorAll('.event-card');
    expect(cards.length).toBe(3);

    // Owner's active event has an Edit button; the cancelled one and others don't.
    const myCard = [...cards].find((c) => c.textContent.includes('My Party'))!;
    const theirCard = [...cards].find((c) => c.textContent.includes('Their Meetup'))!;
    const cancelledCard = [...cards].find((c) => c.textContent.includes('Old Thing'))!;
    expect(myCard.querySelector('.event-edit')).not.toBeNull();
    expect(theirCard.querySelector('.event-edit')).toBeNull();
    expect(cancelledCard.querySelector('.event-edit')).toBeNull();
  });

  it('the star button toggles via onStar with the opposite of viewerStarred', async () => {
    const onStar = vi.fn(() => ok(null));
    await mount({
      load: () => Promise.resolve({ kind: 'ok', events: [ev({ eventId: 'o1', isOwner: false, viewerStarred: true })] }),
      onStar,
    });
    click(container.querySelector('.event-star'));
    expect(onStar).toHaveBeenCalledWith('o1', false);
  });

  it('non-telegram → the Open-in-Telegram nudge', async () => {
    await mount({ load: () => Promise.resolve({ kind: 'non-telegram' }) });
    expect(container.textContent).toContain('Open in Telegram');
  });

  it('error → a Retry button', async () => {
    await mount({ load: () => Promise.resolve({ kind: 'error' }) });
    expect(container.querySelector('.event-retry')).not.toBeNull();
  });
});

describe('EventsPanel — create/edit form', () => {
  it('New event opens a form; submit is blocked until a title is entered', async () => {
    const onCreate = vi.fn((_input: EventInput) => ok<EventView | null>(null));
    await mount({ onCreate });

    click(container.querySelector('.event-new'));
    const submit = container.querySelector<HTMLButtonElement>('.btn-primary')!;
    expect(submit.disabled).toBe(true); // empty title

    const title = container.querySelector<HTMLInputElement>('.event-form input.field-input')!;
    void act(() => {
      title.value = 'Room party';
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);

    click(container.querySelector('.btn-primary'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ title: 'Room party' });
  });

  it('Edit reopens the form pre-filled; Cancel needs the confirm checkbox', async () => {
    const onCancel = vi.fn(() => ok(null));
    await mount({
      load: () => Promise.resolve({ kind: 'ok', events: [ev({ eventId: 'm1', title: 'My Party', isOwner: true })] }),
      onCancel,
    });

    click(container.querySelector('.event-edit'));

    // Pre-filled title.
    const title = container.querySelector<HTMLInputElement>('.event-form input.field-input')!;
    expect(title.value).toBe('My Party');

    // Cancel-event button is disabled until the "you sure" box is ticked.
    const danger = container.querySelector<HTMLButtonElement>('.event-cancel .btn-danger')!;
    expect(danger.disabled).toBe(true);

    const sure = container.querySelector<HTMLInputElement>('.event-cancel input[type="checkbox"]')!;
    void act(() => {
      sure.checked = true;
      sure.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(danger.disabled).toBe(false);

    click(danger);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onCancel).toHaveBeenCalledWith('m1');
  });
});
