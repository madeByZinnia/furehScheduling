// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Roster, RosterResult } from './crewSync';
import { CrewSection } from './CrewSection';
import { __setCrewLoader, __resetCrew } from './crew';

let container: HTMLElement;

beforeEach(() => {
  __resetCrew();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container); // unmount
  container.remove();
  __resetCrew();
});

// One visible member with 2 stars and one ghost member (redacted server-side).
const fakeRoster: Roster = [
  {
    userId: 1,
    displayName: 'Alice',
    ghost: false,
    plans: [{ occurrenceId: 'occ-1', title: 'Opening Ceremonies' }, { occurrenceId: 'occ-2' }],
  },
  { userId: 2, displayName: 'Bob', ghost: true, plans: [] },
];

/** Swap the store loader, render, and flush the mount load + its re-render. */
async function mount(loader: () => Promise<RosterResult>): Promise<void> {
  __setCrewLoader(loader);
  await act(async () => {
    render(<CrewSection />, container);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('CrewSection — roster states, no dead-ends', () => {
  it('ok + members: shows name + star count; ghost shows "Ghost mode" with NO count', async () => {
    await mount(() => Promise.resolve({ kind: 'ok', roster: fakeRoster }));

    const text = container.textContent;
    expect(text).toContain('2 members');
    expect(text).toContain('Alice');
    expect(text).toContain('Bob');
    expect(text).toContain('Ghost mode');

    const rows = container.querySelectorAll('.crew-member');
    expect(rows.length).toBe(2);

    // Alice: a star count badge showing 2.
    const aliceRow = [...rows].find((r) => r.textContent.includes('Alice'))!;
    expect(aliceRow.querySelector('.crew-member-count')!.textContent).toContain('2');

    // Bob (ghost): "Ghost mode" note, and NO count badge (never reveal it).
    const bobRow = [...rows].find((r) => r.textContent.includes('Bob'))!;
    expect(bobRow.querySelector('.crew-member-note')!.textContent).toContain('Ghost mode');
    expect(bobRow.querySelector('.crew-member-count')).toBeNull();
  });

  // CRITICAL: redaction is enforced CLIENT-SIDE. A ghost with a smuggled non-empty
  // plans array must never leak a plan title, and must show no star count.
  it('ok + ghost member with smuggled plans → still redacted client-side', async () => {
    const hostileRoster: Roster = [
      {
        userId: 42,
        displayName: 'Mallory',
        ghost: true,
        plans: [{ occurrenceId: 'X@2026-07-16T10:00:00-06:00', title: 'Secret' }],
      },
    ];
    await mount(() => Promise.resolve({ kind: 'ok', roster: hostileRoster }));

    expect(container.textContent).toContain('Mallory');
    expect(container.textContent).toContain('Ghost mode');
    expect(container.textContent).not.toContain('Secret');

    const rows = container.querySelectorAll('.crew-member');
    const malloryRow = [...rows].find((r) => r.textContent.includes('Mallory'))!;
    expect(malloryRow.querySelector('.crew-member-count')).toBeNull();
  });

  it('non-telegram → the "Open in Telegram" nudge, not an error, no Retry', async () => {
    await mount(() => Promise.resolve({ kind: 'non-telegram' }));
    expect(container.textContent).toContain('Open in Telegram to see your crew.');
    expect(container.querySelector('.crew-retry')).toBeNull();
  });

  it('ok + EMPTY roster → distinct "No crew members yet." empty state, no Retry', async () => {
    await mount(() => Promise.resolve({ kind: 'ok', roster: [] }));
    expect(container.textContent).toContain('No crew members yet.');
    expect(container.textContent).not.toContain('Open in Telegram');
    expect(container.querySelector('.crew-retry')).toBeNull();
  });

  it('error result → error state with a Retry button that re-invokes the loader', async () => {
    let calls = 0;
    const loader = (): Promise<RosterResult> => {
      calls += 1;
      return Promise.resolve({ kind: 'error' });
    };

    await mount(loader);
    expect(calls).toBe(1);
    expect(container.textContent).toContain('Couldn’t load the crew right now.');

    const retry = container.querySelector<HTMLButtonElement>('.crew-retry');
    expect(retry).not.toBeNull();

    await act(async () => {
      retry!.click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toBe(2);
    expect(container.querySelector('.crew-retry')).not.toBeNull();
  });

  it('rejecting loader (defensive) → error state + Retry', async () => {
    let calls = 0;
    const loader = (): Promise<RosterResult> => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    };

    await mount(loader);
    expect(calls).toBe(1);
    expect(container.textContent).toContain('Couldn’t load the crew right now.');
    expect(container.querySelector('.crew-retry')).not.toBeNull();
  });

  it('Refresh in the ready (member list) state re-invokes the loader', async () => {
    let calls = 0;
    const loader = (): Promise<RosterResult> => {
      calls += 1;
      return Promise.resolve({ kind: 'ok', roster: fakeRoster });
    };

    await mount(loader);
    expect(calls).toBe(1);
    expect(container.textContent).toContain('Alice');

    const refresh = container.querySelector<HTMLButtonElement>('.crew-refresh');
    expect(refresh).not.toBeNull();

    await act(async () => {
      refresh!.click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toBe(2);
  });
});
