/**
 * frab / pretalx schedule.json adapter.
 *
 * Moved verbatim out of fetch-schedule.ts so Fureh's ingest stays byte-for-byte
 * identical: same frab flattening, same env overrides
 * (PRETALX_SCHEDULE_URL / PRETALX_TALKS_URL), same optional talks enrichment,
 * same `--fixture` offline path (now carried via AdapterContext.fixturePath).
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  normalizeString,
  type RawSlot,
  type RawTalk,
  type LocalizedString,
} from '../../src/data/expand.ts';
import type { SourceAdapter, AdapterContext } from './types.ts';

// ── pretalx schedule.json (frab-compatible) types ───────────────────────────
// days[].rooms is either { "<Room>": Talk[] } or [{ name, talks: Talk[] }].

interface FrabTalk {
  code?: string;
  url?: string;
  title?: LocalizedString;
  abstract?: LocalizedString;
  description?: LocalizedString;
  track?: LocalizedString | { name?: LocalizedString };
  room?: LocalizedString;
  date?: string; // start, ISO 8601 with offset
  start?: string;
  end?: string;
  duration?: string; // "HH:MM"
}

interface FrabSchedule {
  schedule?: {
    conference?: { days?: FrabDay[] };
    days?: FrabDay[];
  };
  days?: FrabDay[];
}

interface FrabDay {
  date?: string;
  rooms?: Record<string, FrabTalk[]> | Array<{ name?: LocalizedString; talks?: FrabTalk[] }>;
}

function codeFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/talk\/([A-Z0-9]{4,})\b/i);
  return m ? (m[1] as string).toUpperCase() : null;
}

function addDuration(startISO: string, hhmm: string): string {
  const [h = '0', m = '0'] = hhmm.split(':');
  const ms = (Number(h) * 60 + Number(m)) * 60_000;
  return new Date(new Date(startISO).getTime() + ms).toISOString();
}

function normalizeTrack(track: FrabTalk['track']): LocalizedString {
  if (track && typeof track === 'object' && 'name' in track) return track.name;
  return track as LocalizedString;
}

/** Flatten a frab schedule.json into flat slot + talk lists. */
export function adaptFrab(doc: FrabSchedule): { slots: RawSlot[]; talks: RawTalk[] } {
  const days = doc.schedule?.days ?? doc.schedule?.conference?.days ?? doc.days ?? [];
  const slots: RawSlot[] = [];
  const talks = new Map<string, RawTalk>();

  for (const day of days) {
    const roomEntries: Array<[string | undefined, FrabTalk[]]> = Array.isArray(day.rooms)
      ? day.rooms.map((r) => [normalizeString(r.name), r.talks ?? []])
      : Object.entries(day.rooms ?? {});

    for (const [roomName, dayTalks] of roomEntries) {
      for (const t of dayTalks) {
        const code = t.code ?? codeFromUrl(t.url);
        // frab schedule.json puts the FULL ISO start in `date`; `start` is
        // time-only ("17:00"). Prefer `date`; fall back to `start` for API
        // shapes that use it as the full instant.
        const start = t.date ?? t.start;
        if (!start) continue;
        const end = t.end ?? (t.duration ? addDuration(start, t.duration) : start);
        slots.push({ code, title: t.title, room: t.room ?? roomName, start, end });
        if (code) {
          // The same code appears in every one of its slots; only some may carry
          // full metadata. Merge so a non-empty field is never clobbered by a
          // later empty one.
          const prev = talks.get(code);
          talks.set(code, {
            code,
            title: normalizeString(t.title) ? t.title : prev?.title,
            abstract: normalizeString(t.abstract ?? t.description)
              ? (t.abstract ?? t.description)
              : prev?.abstract,
            track: normalizeString(normalizeTrack(t.track)) ? normalizeTrack(t.track) : prev?.track,
          });
        }
      }
    }
  }
  return { slots, talks: [...talks.values()] };
}

/**
 * The frab SourceAdapter. Input precedence preserved exactly:
 *   1. ctx.fixturePath (offline `--fixture <path>`)
 *   2. env PRETALX_SCHEDULE_URL, else con.source.scheduleUrl
 *   + optional env PRETALX_TALKS_URL, else con.source.talksUrl (enrichment)
 */
export const fetchFrab: SourceAdapter = async (ctx: AdapterContext) => {
  const { con, fixturePath } = ctx;
  const source = con.source;
  if (source.kind !== 'frab') throw new Error(`fetchFrab: con ${con.id} is not a frab source`);

  if (fixturePath) {
    const doc = JSON.parse(await readFile(resolve(fixturePath), 'utf8')) as FrabSchedule;
    return adaptFrab(doc);
  }

  // The frab schedule export carries code + abstract + track + room per slot, so
  // it is sufficient on its own — the submissions API (PRETALX_TALKS_URL) is an
  // optional enrichment, not required. Override the URL via env if the feed moves.
  const scheduleUrl = process.env.PRETALX_SCHEDULE_URL ?? source.scheduleUrl;
  const res = await fetch(scheduleUrl);
  if (!res.ok) throw new Error(`GET ${scheduleUrl} → HTTP ${res.status}`);
  const doc = (await res.json()) as FrabSchedule;
  const adapted = adaptFrab(doc);

  const talksUrl = process.env.PRETALX_TALKS_URL ?? source.talksUrl;
  if (talksUrl) {
    const talksRes = await fetch(talksUrl);
    if (!talksRes.ok) throw new Error(`GET ${talksUrl} → HTTP ${talksRes.status}`);
    const raw = (await talksRes.json()) as { results?: RawTalk[] } | RawTalk[];
    const list = Array.isArray(raw) ? raw : (raw.results ?? []);
    const byCode = new Map(adapted.talks.map((t) => [t.code, t]));
    for (const t of list) if (t.code) byCode.set(t.code, { ...byCode.get(t.code), ...t });
    adapted.talks = [...byCode.values()];
  }
  return adapted;
};
