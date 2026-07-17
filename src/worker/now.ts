/**
 * Injectable "now" for the Worker — the server-side twin of src/app/now.ts.
 *
 * workerd has no `location`, so the override is read from a URL you pass in. The
 * digest's "happening now" logic reads its instant from here, so
 * `?now=2026-07-18T13:05:00-06:00` on the trigger endpoint makes the digest
 * behave as if the con were live — the only way to test it before the con
 * actually happens. Never call `Date.now()` for "now" in request-scoped worker
 * code; thread the instant through instead.
 */

/** Parse a `?now=` value into epoch ms, or null if absent / unparseable. */
export function parseNowParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('now');
  if (raw === null || raw === '') return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/** The effective instant for a request — overridden by `?now=` when present. */
export function effectiveNow(url: URL): Date {
  return new Date(parseNowParam(url.search) ?? Date.now());
}
