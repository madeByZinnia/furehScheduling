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

const range = () => container.querySelector<HTMLInputElement>('input.size-range');

describe('DisplaySettings — text-size discrete slider', () => {
  it('renders a 5-stop range initialized from the current size', () => {
    render(<DisplaySettings />, container);
    const r = range();
    expect(r).not.toBeNull();
    expect(r!.type).toBe('range');
    expect(r!.min).toBe('0');
    expect(r!.max).toBe('4');
    expect(r!.step).toBe('1');
    expect(r!.value).toBe('1'); // 'm' is index 1
  });

  it('announces the spoken size name via aria-valuetext, not the index', () => {
    render(<DisplaySettings />, container);
    expect(range()!.getAttribute('aria-valuetext')).toBe('Medium');
    expect(range()!.getAttribute('aria-label')).toBe('Text size');
  });

  it('moving the slider updates the text size (store + document + aria-valuetext)', () => {
    void act(() => {
      render(<DisplaySettings />, container);
    });
    const r = range()!;
    void act(() => {
      r.value = '3';
      r.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(document.documentElement.getAttribute('data-text-size')).toBe('xl');
    // The control re-renders from the store, so the slider reflects the new stop.
    expect(range()!.value).toBe('3');
    expect(range()!.getAttribute('aria-valuetext')).toBe('Extra large');
    expect(container.querySelector('.size-value')!.textContent).toBe('XL');
  });
});
