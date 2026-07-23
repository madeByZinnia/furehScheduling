// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Schedule } from '../data/expand';
import type { OccurrenceId, ItemCode } from '../data/ids';
import type { TelegramSession } from './telegram-session';
import { __setCrewLoader, __resetCrew } from './crew';
import { setActiveCon, conStore } from './con';
import { loadSchedule } from './schedule/load';
import { App } from './App';

// Plain-web session so crew/self logic stays inert.
vi.mock('./telegram-session', () => ({
  getTelegramSession: (): TelegramSession => ({
    initData: null,
    startParam: null,
    user: null,
    authDate: null,
    isTelegram: false,
  }),
}));

// Stub the runtime schedule loader — no network in tests. A single occurrence is
// enough to render the schedule tab past its loading/empty states.
const FIXTURE: Schedule = {
  generatedAt: '2026-01-01T00:00:00Z',
  occurrences: [
    {
      id: 'AAA@2026-08-08T10:00:00-07:00' as OccurrenceId,
      code: 'AAA' as ItemCode,
      title: 'Opening',
      abstract: '',
      track: null,
      room: null,
      start: '2026-08-08T10:00:00-07:00',
      end: '2026-08-08T11:00:00-07:00',
      day: '2026-08-08',
    },
  ],
};
vi.mock('./schedule/load', () => ({
  loadSchedule: vi.fn(() => Promise.resolve(FIXTURE)),
}));

let container: HTMLElement;

beforeEach(() => {
  __resetCrew();
  __setCrewLoader(() => Promise.resolve({ kind: 'non-telegram' }));
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  __resetCrew();
});

async function mount(): Promise<void> {
  await act(async () => {
    render(<App />, container);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('App — con-driven rendering', () => {
  it('shows the con picker when no con resolved at boot', async () => {
    // conStore starts null (clean localStorage, no ?con) — the cold-start path.
    expect(conStore.get()).toBeNull();
    await mount();

    expect(container.querySelector('.con-picker')).not.toBeNull();
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.con-picker-btn'));
    const labels = buttons.map((b) => b.textContent);
    // Every registered con is offered as a button.
    expect(labels).toContain('Tails of Summer 2026');
    expect(labels).toContain('Fur-Eh 2026');
    // Picker replaces the app body — no schedule/nav yet.
    expect(container.querySelector('.bottom-nav')).toBeNull();
  });

  it('picking a con NAVIGATES to ?con=<id> (reload) so stores re-bind that namespace', async () => {
    // The picker must NOT switch in-process: the per-con stores bind their key at
    // module-eval, so an in-process switch would leave a fresh visitor starring
    // into the boot-time fureh.* namespace. Picking navigates to ?con=tos; on the
    // reload, con.ts resolves tos and every store binds tos.*.
    await mount();
    const tos = Array.from(container.querySelectorAll<HTMLButtonElement>('.con-picker-btn')).find(
      (b) => b.textContent === 'Tails of Summer 2026',
    )!;
    await act(async () => {
      tos.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    // Navigation target carries the explicit, highest-priority con selector...
    expect(window.location.search).toBe('?con=tos');
    // ...and the choice is persisted so even a bare reload would resolve it.
    expect(localStorage.getItem('app.lastCon.v1')).toBe('tos');
  });

  it('brands the header with the active con name and loads THAT con', async () => {
    setActiveCon('tos');
    await mount();
    expect(container.querySelector('.app-head h1')!.textContent).toBe('Tails of Summer 2026');
    // Loads the ACTIVE con's schedule, not a hardcoded one (kills loadSchedule('fureh')).
    expect(vi.mocked(loadSchedule)).toHaveBeenCalledWith('tos');
  });
});
