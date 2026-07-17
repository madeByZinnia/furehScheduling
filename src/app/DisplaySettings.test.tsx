// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { setTextSize } from './settings';
import { DisplaySettings } from './DisplaySettings';

let container: HTMLElement;

beforeEach(() => {
  setTextSize('m'); // normalize the shared settings store before each case
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container); // unmount
  container.remove();
  setTextSize('m');
});

// The Text-size control is a segmented group of discrete labelled buttons (a
// slider was tried and reverted — the mid-drag reflow stuttered and the fixed
// stops read more clearly). Each stop is a button with aria-pressed.
const sizeButtons = () =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>('[aria-label="Text size"] button'),
  );
const pressed = () => sizeButtons().find((b) => b.getAttribute('aria-pressed') === 'true');

describe('DisplaySettings — text-size segmented buttons', () => {
  it('renders the 5 discrete stops with the current size pressed', () => {
    render(<DisplaySettings />, container);
    const buttons = sizeButtons();
    expect(buttons.map((b) => b.textContent)).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
    expect(pressed()!.textContent).toBe('M'); // 'm' is the default
  });

  it('clicking a stop updates the text size (store + document) and moves aria-pressed', () => {
    void act(() => {
      render(<DisplaySettings />, container);
    });
    const xl = sizeButtons().find((b) => b.textContent === 'XL')!;
    void act(() => {
      xl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.documentElement.getAttribute('data-text-size')).toBe('xl');
    expect(pressed()!.textContent).toBe('XL');
  });
});
