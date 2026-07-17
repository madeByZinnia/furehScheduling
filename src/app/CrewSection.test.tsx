// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Roster, RosterResult } from './crewSync';
import { CrewSection } from './CrewSection';

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container); // unmount
  container.remove();
});

// A crew with one visible member (1 plan) and one ghost member (no plans in the
// payload — a ghost entry is redacted server-side).
const fakeRoster: Roster = [
  {
    userId: 1,
    displayName: 'Alice',
    ghost: false,
    plans: [{ occurrenceId: 'occ-1', title: 'Opening Ceremonies', start: '10:00' }],
  },
  { userId: 2, displayName: 'Bob', ghost: true, plans: [] },
];

/** Render and flush the mount effect + its resolved/rejected load promise. */
async function mount(load: () => Promise<RosterResult>): Promise<void> {
  await act(async () => {
    render(<CrewSection load={load} />, container);
    await Promise.resolve();
  });
  // A second microtask turn lets the .then() setState re-render settle.
  await act(async () => {
    await Promise.resolve();
  });
}

describe('CrewSection — roster states, no dead-ends', () => {
  it('ok + members: visible member shows a plan, ghost shows "no plans listed"', async () => {
    await mount(() => Promise.resolve({ kind: 'ok', roster: fakeRoster }));

    const text = container.textContent;
    // Visible member's plan title renders.
    expect(text).toContain('Alice');
    expect(text).toContain('Opening Ceremonies');
    // Ghost member is present-but-redacted.
    expect(text).toContain('Bob');
    expect(text).toContain('no plans listed');

    // The ghost member's row shows the redaction text, not a plans list.
    const rows = container.querySelectorAll('.crew-member');
    expect(rows.length).toBe(2);
    const bobRow = [...rows].find((r) => r.textContent.includes('Bob'))!;
    expect(bobRow.querySelector('.crew-member-note')!.textContent).toContain(
      'no plans listed',
    );
    expect(bobRow.querySelector('.crew-member-plans')).toBeNull();
  });

  // CRITICAL: redaction must be enforced CLIENT-SIDE, not merely trusted from the
  // server. A hostile/hypothetical payload where a ghost member carries a NON-empty
  // plans array must still render "no plans listed" and MUST NOT leak any plan.
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
    expect(container.textContent).toContain('no plans listed');
    // The smuggled plan title must NOT appear anywhere in the DOM.
    expect(container.textContent).not.toContain('Secret');

    const rows = container.querySelectorAll('.crew-member');
    const malloryRow = [...rows].find((r) => r.textContent.includes('Mallory'))!;
    expect(malloryRow.querySelector('.crew-member-plans')).toBeNull();
    expect(malloryRow.querySelector('.crew-member-note')!.textContent).toContain(
      'no plans listed',
    );
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

  it('error result → error state with a Retry button that re-invokes load', async () => {
    let calls = 0;
    const load = (): Promise<RosterResult> => {
      calls += 1;
      return Promise.resolve({ kind: 'error' });
    };

    await mount(load);
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

    // Retry re-invoked the loader.
    expect(calls).toBe(2);
    // Still not a dead-end: error + retry remain available.
    expect(container.querySelector('.crew-retry')).not.toBeNull();
  });

  it('rejecting load (defensive) → error state + Retry', async () => {
    let calls = 0;
    const load = (): Promise<RosterResult> => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    };

    await mount(load);
    expect(calls).toBe(1);
    expect(container.textContent).toContain('Couldn’t load the crew right now.');
    expect(container.querySelector('.crew-retry')).not.toBeNull();
  });
});
