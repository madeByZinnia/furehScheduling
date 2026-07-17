// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Roster, RosterResult } from './crewSync';
import { useCrew, refreshCrew, __setCrewLoader, __resetCrew } from './crew';

let container: HTMLElement;

beforeEach(() => {
  __resetCrew();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  __resetCrew();
});

/** Renders the crew store's kind + roster length into the DOM for assertions. */
function Probe() {
  const crew = useCrew();
  const len = crew.kind === 'ok' ? crew.roster.length : -1;
  return (
    <span data-kind={crew.kind} data-len={String(len)}>
      {crew.kind}
    </span>
  );
}

function state(): { kind: string | null; len: string | null } {
  const el = container.querySelector('span');
  return { kind: el?.getAttribute('data-kind') ?? null, len: el?.getAttribute('data-len') ?? null };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function mount(loader: () => Promise<RosterResult>): Promise<void> {
  __setCrewLoader(loader);
  await act(async () => {
    render(<Probe />, container);
    await Promise.resolve();
  });
  await flush();
}

const one: Roster = [{ userId: 1, displayName: 'Alice', ghost: false, plans: [] }];
const two: Roster = [...one, { userId: 2, displayName: 'Bob', ghost: false, plans: [] }];

describe('crew store', () => {
  it('loads the roster on first mount', async () => {
    await mount(() => Promise.resolve({ kind: 'ok', roster: one }));
    expect(state()).toEqual({ kind: 'ok', len: '1' });
  });

  it('maps non-telegram through', async () => {
    await mount(() => Promise.resolve({ kind: 'non-telegram' }));
    expect(state().kind).toBe('non-telegram');
  });

  it('refreshCrew re-invokes the loader and replaces the roster', async () => {
    let calls = 0;
    await mount(() => {
      calls += 1;
      return Promise.resolve({ kind: 'ok', roster: calls === 1 ? one : two });
    });
    expect(state()).toEqual({ kind: 'ok', len: '1' });

    await act(async () => {
      refreshCrew();
      await Promise.resolve();
    });
    await flush();
    expect(calls).toBe(2);
    expect(state()).toEqual({ kind: 'ok', len: '2' });
  });

  it('a refresh keeps the current roster visible (no loading flash)', async () => {
    let resolveSecond!: (r: RosterResult) => void;
    const second = new Promise<RosterResult>((res) => {
      resolveSecond = res;
    });
    let calls = 0;
    await mount(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ kind: 'ok', roster: one }) : second;
    });
    expect(state()).toEqual({ kind: 'ok', len: '1' });

    // Kick a refresh whose load is still in flight.
    await act(async () => {
      refreshCrew();
      await Promise.resolve();
    });
    // Still showing the previous roster — NOT dropped to a loading spinner.
    expect(state()).toEqual({ kind: 'ok', len: '1' });

    await act(async () => {
      resolveSecond({ kind: 'ok', roster: two });
      await Promise.resolve();
    });
    await flush();
    expect(state()).toEqual({ kind: 'ok', len: '2' });
  });

  it('a refresh requested during the initial load is queued, not dropped', async () => {
    // Reproduces the boot race: the star-sync lands while the very first roster
    // fetch is still in flight. The queued refresh must run and win.
    let resolveFirst!: (r: RosterResult) => void;
    const first = new Promise<RosterResult>((res) => {
      resolveFirst = res;
    });
    let calls = 0;
    await mount(() => {
      calls += 1;
      return calls === 1 ? first : Promise.resolve({ kind: 'ok', roster: two });
    });
    expect(state().kind).toBe('loading'); // first load still in flight

    // A sync lands mid-load → refresh requested while inflight.
    await act(async () => {
      refreshCrew();
      await Promise.resolve();
    });

    // Now the pre-sync first load resolves; the queued refresh must then run.
    await act(async () => {
      resolveFirst({ kind: 'ok', roster: one });
      await Promise.resolve();
    });
    await flush();
    await flush();

    expect(calls).toBe(2); // the queued refresh was NOT dropped
    expect(state()).toEqual({ kind: 'ok', len: '2' }); // second (post-sync) load won
  });

  it('a background refresh returning {kind:"error"} keeps the last good roster', async () => {
    // fetchRoster reports failures as { kind: 'error' } (not a reject), so this
    // path must be preserved too — complements the reject-based case below.
    let calls = 0;
    await mount(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve({ kind: 'ok', roster: one })
        : Promise.resolve({ kind: 'error' });
    });
    expect(state()).toEqual({ kind: 'ok', len: '1' });

    await act(async () => {
      refreshCrew();
      await Promise.resolve();
    });
    await flush();
    expect(state()).toEqual({ kind: 'ok', len: '1' }); // error result did not clobber
  });

  it('a failed background refresh keeps the last good roster', async () => {
    let calls = 0;
    await mount(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve({ kind: 'ok', roster: one })
        : Promise.reject(new Error('network'));
    });
    expect(state()).toEqual({ kind: 'ok', len: '1' });

    await act(async () => {
      refreshCrew();
      await Promise.resolve();
    });
    await flush();
    // The reject did NOT clobber the good roster with an error state.
    expect(state()).toEqual({ kind: 'ok', len: '1' });
  });
});
