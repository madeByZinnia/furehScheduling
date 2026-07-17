import { TABS, type Tab } from './tabs';

/**
 * Fixed bottom navigation switching the three top-level views.
 *
 * Semantics: a `<nav>` of plain buttons with `aria-current="page"`, NOT an ARIA
 * `tablist`. A tablist is a keyboard widget (roving tabindex + arrow-key
 * traversal); a half-built one is worse than none, and a bottom bar reads
 * naturally as site navigation. This matches the codebase's honest-semantics
 * choice for the day filter (see `DayTabs` in schedule/ScheduleView.tsx). Buttons
 * are fully keyboard-native as-is, and the active view is signalled by
 * `aria-current` plus a visible **bold weight + top accent bar** — never colour
 * alone (a11y house style).
 */
export function BottomNav({
  active,
  onSelect,
}: {
  active: Tab;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <nav class="bottom-nav" aria-label="Main">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            class={`bottom-nav-tab${isActive ? ' is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(tab.id)}
          >
            <span class="bottom-nav-icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span class="bottom-nav-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
