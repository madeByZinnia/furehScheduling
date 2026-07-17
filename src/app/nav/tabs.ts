/** The top-level views the bottom nav switches between. */
export type Tab = 'schedule' | 'map' | 'crew' | 'me';

export interface TabDef {
  id: Tab;
  /** Visible label — the tab's accessible name (icon+text, never icon-only). */
  label: string;
  /** Decorative emoji, aria-hidden; the label carries the meaning. */
  icon: string;
}

export const TABS: readonly TabDef[] = [
  { id: 'schedule', label: 'Schedule', icon: '📜' },
  { id: 'map', label: 'Map', icon: '🗺️' },
  { id: 'crew', label: 'Crew', icon: '🐾' },
  { id: 'me', label: 'Me', icon: '👤' },
];
