// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

// Spy the real listEvents so we can render EventsPanel with its DEFAULT loader
// (the production path) and count how often it fires.
vi.mock('../events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../events')>();
  return { ...actual, listEvents: vi.fn(actual.listEvents) };
});

import { EventsPanel } from './EventsPanel';
import { listEvents } from '../events';

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.mocked(listEvents).mockClear();
});
afterEach(() => {
  render(null, container);
  container.remove();
});

describe('EventsPanel — default loader is stable (no fetch loop)', () => {
  it('renders with default props and loads exactly once', async () => {
    // No `load` prop → the module-level default runs. On plain web it resolves to
    // non-telegram WITHOUT a fetch. With an unstable inline default, the load
    // effect would re-fire on every completed request → an infinite loop.
    await act(async () => {
      render(<EventsPanel />, container);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(vi.mocked(listEvents)).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Open in Telegram');
  });
});
