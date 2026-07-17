// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { AboutDev } from './AboutDev';

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  render(null, container);
  container.remove();
});

describe('AboutDev', () => {
  it('is a collapsed disclosure with the dev contact links', () => {
    render(<AboutDev />, container);
    const details = container.querySelector('details.about-dev');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false); // hidden until opened

    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://t.me/rpg_soundsystem');
    expect(hrefs).toContain('https://github.com/madeByZinnia');
  });
});
