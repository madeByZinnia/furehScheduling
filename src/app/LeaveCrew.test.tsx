// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { MutationResult } from './events';

vi.mock('./crewSync', () => ({ suspendAutoSync: vi.fn() }));

import { LeaveCrew } from './LeaveCrew';
import { suspendAutoSync } from './crewSync';

let container: HTMLElement;

beforeEach(() => {
  vi.mocked(suspendAutoSync).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  render(null, container);
  container.remove();
});

const okLeave = (): Promise<MutationResult> => Promise.resolve({ ok: true, value: null });

const click = (el: Element | null) =>
  void act(() => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('LeaveCrew', () => {
  it('renders nothing on plain web (no crew to leave)', () => {
    void act(() => {
      render(<LeaveCrew isTelegram={false} onLeave={vi.fn(okLeave)} />, container);
    });
    expect(container.textContent).toBe('');
  });

  it('the "also cancel my events" box defaults UNCHECKED; leaving without it sends false', async () => {
    const onLeave = vi.fn(okLeave);
    void act(() => {
      render(<LeaveCrew isTelegram onLeave={onLeave} />, container);
    });

    click(container.querySelector('.btn-danger')); // open the confirm
    const box = container.querySelector<HTMLInputElement>('.check input[type="checkbox"]')!;
    expect(box.checked).toBe(false); // bgx.1: never pre-ticked

    // Confirm without ticking → cancelOwnEvents must be false.
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('.leave-actions .btn-danger')].find(
      (b) => b.textContent.includes('Leave crew'),
    )!;
    click(confirm);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onLeave).toHaveBeenCalledWith(false);
  });

  it('re-opening the confirm after a dismiss resets the box to unchecked', () => {
    void act(() => {
      render(<LeaveCrew isTelegram onLeave={vi.fn(okLeave)} />, container);
    });

    click(container.querySelector('.btn-danger')); // open
    const box = container.querySelector<HTMLInputElement>('.check input[type="checkbox"]')!;
    void act(() => {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });

    click(container.querySelector('.event-back')); // ✕ Keep me in (dismiss)
    click(container.querySelector('.btn-danger')); // re-open

    const reopened = container.querySelector<HTMLInputElement>('.check input[type="checkbox"]')!;
    expect(reopened.checked).toBe(false); // bgx.1: never carries a previous tick
  });

  it('suspends auto-sync on a successful leave (a later change must not re-add you)', async () => {
    void act(() => {
      render(<LeaveCrew isTelegram onLeave={vi.fn(okLeave)} />, container);
    });
    click(container.querySelector('.btn-danger')); // open
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('.leave-actions .btn-danger')].find(
      (b) => b.textContent.includes('Leave crew'),
    )!;
    click(confirm);
    await act(async () => {
      await Promise.resolve();
    });
    expect(vi.mocked(suspendAutoSync)).toHaveBeenCalledTimes(1);
  });

  it('ticking the box sends cancelOwnEvents = true', async () => {
    const onLeave = vi.fn(okLeave);
    void act(() => {
      render(<LeaveCrew isTelegram onLeave={onLeave} />, container);
    });

    click(container.querySelector('.btn-danger'));
    const box = container.querySelector<HTMLInputElement>('.check input[type="checkbox"]')!;
    void act(() => {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const confirm = [...container.querySelectorAll<HTMLButtonElement>('.leave-actions .btn-danger')].find(
      (b) => b.textContent.includes('Leave crew'),
    )!;
    click(confirm);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onLeave).toHaveBeenCalledWith(true);
  });
});
