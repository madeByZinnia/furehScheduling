import { createStore, useStore } from './store';

/**
 * Display settings — Theme and Text size, split into two independent controls
 * (per the mockup-feedback revision). Both persist and apply to <html> via data
 * attributes that a11y.css keys on. Telegram does NOT forward the OS text-size
 * setting into its webview, so the in-app text-size control is load-bearing.
 */

export type Theme = 'system' | 'dark' | 'light';
export const TEXT_SIZES = ['s', 'm', 'l', 'xl', 'xxl'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

// Theme + text size are DEVICE-global (not per-con): the same eyes want the same
// contrast/size at every con, so these keep the `app.*` namespace rather than the
// per-con `conKey()` one used by stars/ghost/profile.
const THEME_KEY = 'app.theme.v1';
const TEXT_KEY = 'app.textSize.v1';
const OLD_THEME_KEY = 'fureh.theme.v1';
const OLD_TEXT_KEY = 'fureh.textSize.v1';
const DEFAULT_TEXT: TextSize = 'm'; // deliberately lower baseline, headroom above

/**
 * One-time key rename: if the new `app.*` key is absent but the pre-multi-con
 * `fureh.*` key exists, copy it forward so an existing user keeps their theme /
 * text size. Runs at module eval, before the stores read the new keys.
 */
function migrateKey(newKey: string, oldKey: string): void {
  if (safeGet(newKey) !== null) return;
  const old = safeGet(oldKey);
  if (old !== null) safeSet(newKey, old);
}
migrateKey(THEME_KEY, OLD_THEME_KEY);
migrateKey(TEXT_KEY, OLD_TEXT_KEY);

function readTheme(): Theme {
  const v = safeGet(THEME_KEY);
  return v === 'dark' || v === 'light' || v === 'system' ? v : 'system';
}
function readTextSize(): TextSize {
  const v = safeGet(TEXT_KEY);
  return (TEXT_SIZES as readonly string[]).includes(v ?? '') ? (v as TextSize) : DEFAULT_TEXT;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

const themeStore = createStore<Theme>(readTheme());
const textStore = createStore<TextSize>(readTextSize());

function apply(): void {
  const root = document.documentElement;
  const theme = themeStore.get();
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.setAttribute('data-text-size', textStore.get());
}

/** Apply persisted settings to the document. Call once at startup. */
export function initSettings(): void {
  apply();
}

export function setTheme(theme: Theme): void {
  safeSet(THEME_KEY, theme);
  themeStore.set(theme);
  apply();
}

export function setTextSize(size: TextSize): void {
  safeSet(TEXT_KEY, size);
  textStore.set(size);
  apply();
}

export const useTheme = (): Theme => useStore(themeStore);
export const useTextSize = (): TextSize => useStore(textStore);
