/**
 * Time-travel override — build FIRST, everything time-based reads from here.
 *
 * `?now=2026-07-18T13:05:00-06:00` makes every now-dependent surface (the "on
 * now" separator, map highlighting, the digest) behave as if it were that
 * instant. The con has not happened yet, so without this there is no way to test
 * any of it. Never call `Date.now()` / `new Date()` for "now" elsewhere — call
 * `now()`.
 */

let overrideEpochMs: number | null = null;

/** Parse a `?now=` value into epoch ms, or null if absent/unparseable. */
export function parseNowParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('now');
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/** Apply the override from a URL query string (defaults to the live URL). */
export function configureNow(search: string = location.search): void {
  overrideEpochMs = parseNowParam(search);
}

/** The effective current instant — overridden by `?now=` when present. */
export function now(): Date {
  return new Date(overrideEpochMs ?? Date.now());
}

/** True when a `?now=` override is active (surfaces can show a time-travel badge). */
export function isTimeTravelling(): boolean {
  return overrideEpochMs !== null;
}
