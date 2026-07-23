/**
 * SPA-side schedule loader.
 *
 * Replaces the old baked `import schedule.json` model with a runtime fetch, so a
 * live KV edit (served by GET /api/schedule) can update the schedule without a
 * rebuild. Two environments, one code path:
 *
 *   - prod: `GET /api/schedule?con=<id>` — the Worker reads KV first, then the
 *     baked asset, so the SPA always sees the freshest schedule.
 *   - dev (`vite dev`): there is NO Worker, so fetch the generated file directly
 *     at `/data/<id>.json`. Vite serves `public/data/` at `/data/` in dev and
 *     copies it to `dist/data/` for prod, so the same path resolves in both.
 *
 * The URL choice is a pure function (`scheduleUrl`) so it is unit-testable without
 * stubbing `import.meta.env`.
 */
import type { Schedule } from '../../data/expand';

/**
 * The URL to fetch a con's schedule from, given whether we're in the dev server.
 * Pure — no globals — so tests pin both branches directly.
 */
export function scheduleUrl(conId: string, isDev: boolean): string {
  return isDev
    ? `/data/${encodeURIComponent(conId)}.json`
    : `/api/schedule?con=${encodeURIComponent(conId)}`;
}

/** Every field a consumer dereferences must be present and the right type. */
function isOccurrence(o: unknown): boolean {
  if (typeof o !== 'object' || o === null) return false;
  const r = o as Record<string, unknown>;
  const isStr = (k: string): boolean => typeof r[k] === 'string';
  const isStrOrNull = (k: string): boolean => r[k] === null || typeof r[k] === 'string';
  return (
    isStr('id') &&
    isStr('code') &&
    isStr('title') &&
    isStr('abstract') &&
    isStr('start') &&
    isStr('end') &&
    isStr('day') &&
    isStrOrNull('room') &&
    isStrOrNull('track') &&
    (r.hosts === undefined ||
      (Array.isArray(r.hosts) && r.hosts.every((h) => typeof h === 'string')))
  );
}

/** Narrow unknown parsed JSON to a Schedule, or throw a clear error. */
function assertSchedule(value: unknown, conId: string): Schedule {
  // Keep `value` as `unknown` for the runtime checks (casting first would make
  // the object/null guards provably-true to the type-checker); narrow to a record
  // only to read the two fields.
  if (typeof value !== 'object' || value === null) {
    throw new Error(`schedule for "${conId}" is malformed (not an object)`);
  }
  const v = value as { generatedAt?: unknown; occurrences?: unknown };
  if (
    typeof v.generatedAt !== 'string' ||
    !Array.isArray(v.occurrences) ||
    !v.occurrences.every(isOccurrence)
  ) {
    throw new Error(`schedule for "${conId}" is malformed (not a valid Schedule)`);
  }
  return value as Schedule;
}

/**
 * Fetch and validate one con's schedule. Throws a clear error on a non-ok
 * response or a shape that isn't a Schedule, so callers never silently render an
 * empty or garbage feed.
 */
export async function loadSchedule(conId: string): Promise<Schedule> {
  const res = await fetch(scheduleUrl(conId, import.meta.env.DEV));
  if (!res.ok) {
    throw new Error(`failed to load schedule for "${conId}": HTTP ${res.status}`);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    // e.g. the SPA index.html shell served for a missing asset — surface a
    // clear, con-scoped error rather than a bare SyntaxError.
    throw new Error(`schedule for "${conId}" was not valid JSON`);
  }
  return assertSchedule(parsed, conId);
}
