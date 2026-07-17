// @vitest-environment happy-dom
import { render } from 'preact';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BottomNav } from './BottomNav';

describe('BottomNav', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renders four tabs, each with a visible text label', () => {
    render(<BottomNav active="schedule" onSelect={() => {}} />, container);
    const tabs = container.querySelectorAll('.bottom-nav-tab');
    expect(tabs.length).toBe(4);
    expect(container.textContent).toContain('Schedule');
    expect(container.textContent).toContain('Map');
    expect(container.textContent).toContain('Crew');
    expect(container.textContent).toContain('Me');
  });

  it('marks exactly the active tab with aria-current="page"', () => {
    render(<BottomNav active="crew" onSelect={() => {}} />, container);
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0]?.textContent).toContain('Crew');
  });

  it('calls onSelect with the tab id when a tab is clicked', () => {
    const onSelect = vi.fn();
    render(<BottomNav active="schedule" onSelect={onSelect} />, container);
    const buttons = Array.from(container.querySelectorAll('button'));
    const meButton = buttons.find((b) => b.textContent.includes('Me'));
    expect(meButton).toBeTruthy();
    meButton?.click();
    expect(onSelect).toHaveBeenCalledWith('me');
  });
});
