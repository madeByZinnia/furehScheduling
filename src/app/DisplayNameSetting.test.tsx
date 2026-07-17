// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { TelegramSession } from './telegram-session';

const session: TelegramSession = {
  initData: 'x',
  startParam: null,
  user: { id: 1, firstName: 'Robin' },
  authDate: null,
  isTelegram: true,
};
vi.mock('./telegram-session', () => ({ getTelegramSession: () => session }));

import { DisplayNameSetting } from './DisplayNameSetting';
import { getDisplayName, setDisplayName, __resetDisplayName } from './profile';

let container: HTMLElement;

beforeEach(() => {
  __resetDisplayName();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  render(null, container);
  container.remove();
  __resetDisplayName();
});

describe('DisplayNameSetting', () => {
  it('uses the Telegram name as the placeholder', () => {
    void act(() => {
      render(<DisplayNameSetting />, container);
    });
    const input = container.querySelector<HTMLInputElement>('input.field-input')!;
    expect(input.placeholder).toContain('Robin');
  });

  it('writes typed input to the display-name store', () => {
    void act(() => {
      render(<DisplayNameSetting />, container);
    });
    const input = container.querySelector<HTMLInputElement>('input.field-input')!;
    void act(() => {
      input.value = 'Zinnia';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(getDisplayName()).toBe('Zinnia');
  });

  it('reflects an existing custom name on mount', () => {
    setDisplayName('Nyx');
    void act(() => {
      render(<DisplayNameSetting />, container);
    });
    const input = container.querySelector<HTMLInputElement>('input.field-input')!;
    expect(input.value).toBe('Nyx');
  });
});
