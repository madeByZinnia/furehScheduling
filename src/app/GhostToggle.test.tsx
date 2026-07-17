// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { getGhost, __resetGhost } from './ghost';
import { GhostToggle } from './GhostToggle';

let container: HTMLElement;

beforeEach(() => {
  __resetGhost();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container); // unmount
  container.remove();
  __resetGhost();
});

const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]');

describe('GhostToggle — accessible ghost switch', () => {
  it('renders UNCHECKED by default (store defaults OFF)', () => {
    render(<GhostToggle />, container);
    const cb = checkbox();
    expect(cb).not.toBeNull();
    expect(cb!.checked).toBe(false);
    expect(getGhost()).toBe(false);
  });

  it('has a real label and the plain-language help text', () => {
    render(<GhostToggle />, container);
    expect(container.querySelector('label')).not.toBeNull();
    expect(container.textContent).toContain('Ghost mode');
    expect(container.querySelector('.ghost-toggle-help')!.textContent).toContain(
      'no plans listed',
    );
  });

  it('toggling ON flips and persists the store, then back OFF', () => {
    render(<GhostToggle />, container);
    const cb = checkbox()!;

    void act(() => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(getGhost()).toBe(true);
    expect(checkbox()!.checked).toBe(true);

    void act(() => {
      const c = checkbox()!;
      c.checked = false;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(getGhost()).toBe(false);
    expect(checkbox()!.checked).toBe(false);
  });
});
