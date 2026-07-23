/**
 * Shared "con-activities" adapter.
 *
 * Canfurence and Tails of Summer run the same scheduling platform, so one
 * normalizer (`adaptConScheduleActivities`) handles both; only the fetch/flatten
 * shell differs (`fetchCanfurence` = day-grouped panels object, `fetchTos` =
 * two flat arrays with a separate rooms table).
 *
 * THE single most important transform: activity `start`/`end` arrive WITHOUT a
 * timezone offset (`"2026-08-08T08:00:00"`). We append `con.utcOffset` so every
 * downstream instant is unambiguous — expandOccurrences' day bucketing depends
 * on it. See activities.test.ts.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RawSlot, RawTalk } from '../../src/data/expand.ts';
import type { ConConfig } from '../../src/data/cons.ts';
import type { SourceAdapter, AdapterContext } from './types.ts';

// ── the shared upstream activity shape ──────────────────────────────────────

interface ActivityHost {
  hostHandle?: number;
  registrantUID?: number | null;
  hostTitle?: string | null;
  displayName?: string;
}

export interface Activity {
  title?: string;
  start: string;
  end: string;
  resourceId?: number | string;
  /** Canfurence carries the room name inline; ToS resolves it via roomsById. */
  resourceName?: string;
  durationInMin?: number;
  activityTypeID?: number;
  activityID?: number;
  activityTypeTitle?: string;
  activityColour?: string;
  activityStatus?: string;
  description?: string;
  activityHosts?: ActivityHost[];
  color?: string;
  textColor?: string;
  handle?: number | string;
  activityType?: string;
}

// Canfurence upstream: { "SATURDAY": [{ time, panels: Activity[] }, ...], ... }.
// Flattened defensively at runtime by flattenCanfurence (shape not trusted).

// ToS resources feed row.
interface TosResource {
  id: number | string;
  roomName?: string;
  title?: string;
}

/**
 * Build ToS's resourceId → room-name map. `||` (not `??`) so an EMPTY
 * `roomName` falls back to the resource `title` rather than becoming ''.
 */
export function buildTosRoomsById(resources: TosResource[]): Map<string, string> {
  return new Map(resources.map((r) => [String(r.id), r.roomName || r.title || '']));
}

// A timestamp counts as already-offset only when it is a `T`-bearing datetime
// ending in an ANCHORED `±HH:MM` / `±HHMM` / `Z`. Anchoring at end avoids being
// fooled by the date's own hyphens ('2026-08-08') or by an offset mid-string,
// and requiring `T` avoids treating a bare date as a full instant.
const ANCHORED_OFFSET_RE = /(?:[+-]\d{2}:?\d{2}|Z)$/i;

/**
 * Append `con.utcOffset` unless the timestamp already carries its own offset,
 * then assert the result parses. Rejects date-only ('2026-08-08') and junk
 * ('...Zjunk') loudly instead of silently minting an Invalid Date, and never
 * double-appends onto an already-offset value.
 */
function withOffset(dt: string, utcOffset: string): string {
  const alreadyOffset = dt.includes('T') && ANCHORED_OFFSET_RE.test(dt);
  const result = alreadyOffset ? dt : dt + utcOffset;
  if (Number.isNaN(Date.parse(result))) {
    throw new Error(`unparseable timestamp: ${JSON.stringify(dt)} (→ ${JSON.stringify(result)})`);
  }
  return result;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** code = activityID, else a slug of handle/title, else null (code-less path). */
function codeFor(a: Activity): string | null {
  if (a.activityID != null) return String(a.activityID);
  const basis = a.handle ?? a.title;
  if (basis != null) {
    const slug = slugify(String(basis));
    if (slug) return slug;
  }
  return null;
}

/** room = inline resourceName, else roomsById[resourceId], else null. */
function roomFor(a: Activity, roomsById?: Map<string, string>): string | null {
  if (a.resourceName != null && a.resourceName !== '') return a.resourceName;
  if (roomsById && a.resourceId != null) {
    const name = roomsById.get(String(a.resourceId));
    if (name != null && name !== '') return name;
  }
  return null;
}

/**
 * Strip HTML to plain text: block-close / <br> tags become newlines so
 * paragraphs survive, all remaining tags are removed, common entities are
 * decoded, horizontal whitespace runs collapse, blank-line runs cap at one.
 * No HTML tag may remain in the output.
 */
export function stripHtml(html: string): string {
  if (typeof html !== 'string' || !html) return '';
  let s = html;
  // Drop <script>/<style> blocks INCLUDING their contents, and HTML comments,
  // before anything else so their bodies never leak into the text.
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Block boundaries → newlines, before remaining tags are stripped.
  s = s.replace(/<\/p\s*>/gi, '\n\n');
  s = s.replace(/<\/div\s*>/gi, '\n\n');
  s = s.replace(/<\/li\s*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Remove every remaining tag, plus a trailing unclosed one (`...<b`).
  // Only strip TAG-LIKE `<...>` (starts with a letter, `/`, or `!`) so literal
  // comparison text like `1 < 2` or the `<3` emoticon is preserved, while real
  // and entity-revealed tags (`<b>`, `<!doctype>`, a trailing unclosed `<img`)
  // are removed.
  s = s.replace(/<\/?[a-zA-Z!][^>]*>/g, '').replace(/<\/?[a-zA-Z!][^>]*$/g, '');
  // Decode entities: named + decimal + hex numeric.
  s = decodeEntities(s);
  // An entity may have revealed a literal tag (e.g. `&lt;img&gt;`) — strip once
  // more so no `<tag>` survives decoding.
  // Only strip TAG-LIKE `<...>` (starts with a letter, `/`, or `!`) so literal
  // comparison text like `1 < 2` or the `<3` emoticon is preserved, while real
  // and entity-revealed tags (`<b>`, `<!doctype>`, a trailing unclosed `<img`)
  // are removed.
  s = s.replace(/<\/?[a-zA-Z!][^>]*>/g, '').replace(/<\/?[a-zA-Z!][^>]*$/g, '');
  // Collapse horizontal whitespace, tidy newlines, trim.
  s = s.replace(/[^\S\n]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Decode the common named entities plus decimal (&#60;) / hex (&#x3c;) refs. */
function decodeEntities(s: string): string {
  let out = s;
  for (const [ent, ch] of Object.entries(NAMED_ENTITIES)) {
    out = out.replace(new RegExp(ent, 'gi'), ch);
  }
  out = out.replace(/&#(\d+);/g, (_m, dec: string) => codePoint(parseInt(dec, 10)));
  out = out.replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => codePoint(parseInt(hex, 16)));
  return out;
}

function codePoint(n: number): string {
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

/**
 * Normalize a flat list of con-platform activities into slots + talks.
 * One activity == one code (1:1), so talks dedupe trivially by code.
 */
export function adaptConScheduleActivities(
  activities: Activity[],
  opts: { con: ConConfig; roomsById?: Map<string, string> },
): { slots: RawSlot[]; talks: RawTalk[] } {
  const { con, roomsById } = opts;
  const slots: RawSlot[] = [];
  const talks = new Map<string, RawTalk>();

  for (const a of activities) {
    const start = withOffset(a.start, con.utcOffset);
    const end = withOffset(a.end, con.utcOffset);
    const code = codeFor(a);
    const title = a.title ?? '';
    const room = roomFor(a, roomsById);

    slots.push({ code, title, room, start, end });

    if (code == null) continue;
    const existing = talks.get(code);
    if (existing) {
      // Recurring events legitimately reuse one code across slots (Canfurence
      // has 108 codes over 133 slots) — first-wins is correct. But if the two
      // carry DIFFERENT non-empty titles, the feed may be reusing an id for
      // unrelated content; surface it rather than silently dropping one.
      const prevTitle = typeof existing.title === 'string' ? existing.title : '';
      if (title && prevTitle && title !== prevTitle) {
        console.warn(
          `[adaptConScheduleActivities] code ${code} reused with differing titles: ` +
            `${JSON.stringify(prevTitle)} vs ${JSON.stringify(title)} (keeping first)`,
        );
      }
      continue;
    }

    const hosts = (a.activityHosts ?? [])
      .map((h) => h.displayName)
      .filter((n): n is string => Boolean(n));
    const talk: RawTalk = {
      code,
      title,
      abstract: stripHtml(a.description ?? ''),
      track: a.activityTypeTitle || null,
    };
    if (hosts.length > 0) talk.hosts = hosts;
    talks.set(code, talk);
  }

  return { slots, talks: [...talks.values()] };
}

// ── I/O shells ──────────────────────────────────────────────────────────────

async function loadJson<T>(url: string, fixturePath?: string): Promise<T> {
  if (fixturePath) return JSON.parse(await readFile(resolve(fixturePath), 'utf8')) as T;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Flatten Canfurence's day-grouped panels object defensively: a non-array day,
 * a non-array `panels`, a null slot, or a non-object / start-less panel is
 * skipped rather than allowed to throw or leak. Only objects with a string
 * `start` become activities.
 */
export function flattenCanfurence(doc: unknown): Activity[] {
  const out: Activity[] = [];
  if (doc == null || typeof doc !== 'object') return out;
  for (const day of Object.values(doc as Record<string, unknown>)) {
    if (!Array.isArray(day)) continue;
    for (const slot of day as unknown[]) {
      const panels = (slot as { panels?: unknown } | null | undefined)?.panels;
      if (!Array.isArray(panels)) continue;
      for (const p of panels as unknown[]) {
        if (
          p != null &&
          typeof p === 'object' &&
          typeof (p as Activity).start === 'string' &&
          typeof (p as Activity).end === 'string'
        ) {
          out.push(p as Activity);
        }
      }
    }
  }
  return out;
}

/** Canfurence: fetch the day-grouped panels object and flatten to activities. */
export const fetchCanfurence: SourceAdapter = async (ctx: AdapterContext) => {
  const { con, fixturePath } = ctx;
  if (con.source.kind !== 'con-activities') {
    throw new Error(`fetchCanfurence: con ${con.id} is not a con-activities source`);
  }
  const doc = await loadJson<unknown>(con.source.activitiesUrl, fixturePath);
  const activities = flattenCanfurence(doc);
  return adaptConScheduleActivities(activities, { con });
};

/** ToS: fetch activities + resources in parallel, resolve rooms, normalize. */
export const fetchTos: SourceAdapter = async (ctx: AdapterContext) => {
  const { con, fixturePath } = ctx;
  if (con.source.kind !== 'con-activities') {
    throw new Error(`fetchTos: con ${con.id} is not a con-activities source`);
  }
  const { activitiesUrl, resourcesUrl } = con.source;
  if (!resourcesUrl) throw new Error(`fetchTos: con ${con.id} has no resourcesUrl`);

  // Offline: fixturePath points at the activities fixture; derive the sibling
  // resources fixture by name so both come from disk.
  const resFixture = fixturePath?.replace('activities', 'resources');

  const [activities, resources] = await Promise.all([
    loadJson<Activity[]>(activitiesUrl, fixturePath),
    loadJson<TosResource[]>(resourcesUrl, resFixture),
  ]);

  const roomsById = buildTosRoomsById(resources);
  return adaptConScheduleActivities(activities, { con, roomsById });
};
