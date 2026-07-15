/**
 * fetch-schedule.ts — pretalx join + occurrence expansion + assertions.
 *
 * Run via `npm run schedule` (tsx). Fetches the pretalx schedule (208 slots) and
 * talks (178 submissions), joins on `code`, expands every slot into its own
 * stable occurrence (see src/data/expand.ts), asserts the known-good invariants,
 * and writes src/data/schedule.json.
 *
 * INPUT — supply one of:
 *   PRETALX_SCHEDULE_URL   frab/pretalx schedule.json (days → rooms → talks)
 *   PRETALX_TALKS_URL      pretalx talks API (abstract/track enrichment), optional
 *   --fixture <path>       local JSON in the same schedule.json shape (offline)
 *
 * The live endpoint URLs for Fur-Eh 2026 still need to be plugged in and this
 * script verified against the real feed — see bead fureh-schedules (M0). Until
 * then the expansion logic is fully covered by property tests on synthetic data.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  expandOccurrences,
  uniqueCodes,
  uniqueDays,
  normalizeString,
  type RawSlot,
  type RawTalk,
  type LocalizedString,
  type Schedule,
} from '../src/data/expand.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/schedule.json');

// ── pretalx schedule.json (frab-compatible) adapters ────────────────────────
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
function adaptFrab(doc: FrabSchedule): { slots: RawSlot[]; talks: RawTalk[] } {
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
            track: normalizeString(normalizeTrack(t.track))
              ? normalizeTrack(t.track)
              : prev?.track,
          });
        }
      }
    }
  }
  return { slots, talks: [...talks.values()] };
}

// ── input loading ───────────────────────────────────────────────────────────

async function loadInput(): Promise<{ slots: RawSlot[]; talks: RawTalk[] }> {
  const fixtureFlag = process.argv.indexOf('--fixture');
  if (fixtureFlag !== -1) {
    const path = process.argv[fixtureFlag + 1];
    if (!path) throw new Error('--fixture requires a path');
    const doc = JSON.parse(await readFile(resolve(path), 'utf8')) as FrabSchedule;
    return adaptFrab(doc);
  }

  // The frab schedule export carries code + abstract + track + room per slot, so
  // it is sufficient on its own — the submissions API (PRETALX_TALKS_URL) is an
  // optional enrichment, not required. Override the URL via env if the feed moves.
  const scheduleUrl =
    process.env.PRETALX_SCHEDULE_URL ??
    'https://events.fureh.ca/2026/schedule/export/schedule.json';
  const res = await fetch(scheduleUrl);
  if (!res.ok) throw new Error(`GET ${scheduleUrl} → HTTP ${res.status}`);
  const doc = (await res.json()) as FrabSchedule;
  const adapted = adaptFrab(doc);

  const talksUrl = process.env.PRETALX_TALKS_URL;
  if (talksUrl) {
    const raw = (await (await fetch(talksUrl)).json()) as { results?: RawTalk[] } | RawTalk[];
    const list = Array.isArray(raw) ? raw : (raw.results ?? []);
    const byCode = new Map(adapted.talks.map((t) => [t.code, t]));
    for (const t of list) if (t.code) byCode.set(t.code, { ...byCode.get(t.code), ...t });
    adapted.talks = [...byCode.values()];
  }
  return adapted;
}

// ── assertions ──────────────────────────────────────────────────────────────

interface Expectations {
  slots: number;
  codes: number;
  days: number;
  /** Expected occurrence count keyed by either a submission code or a title. */
  perItem: Record<string, number>;
}

// Known-good facts, verified against the live Fur-Eh 2026 feed
// (events.fureh.ca/2026/schedule/export/schedule.json) on 2026-07-15. These
// gate the write. The master plan quoted 208/178 with 4 code-less Overflow
// entries; the feed has since drifted to 207 slots / 177 codes / 0 code-less,
// while Registration->5 and CZKVLN->4 still hold exactly. Update these if the
// feed changes materially.
const EXPECT: Expectations = {
  slots: 207,
  codes: 177,
  days: 4,
  // Registration is matched by title (its code is 9JBJJY); CZKVLN by code.
  perItem: { Registration: 5, CZKVLN: 4 },
};

function assertInvariants(schedule: Schedule): string[] {
  const { occurrences } = schedule;
  const failures: string[] = [];

  const check = (name: string, actual: number, expected: number) => {
    const ok = actual === expected;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${actual} (expected ${expected})`);
    if (!ok) failures.push(`${name}: got ${actual}, expected ${expected}`);
  };

  check('slots', occurrences.length, EXPECT.slots);
  check('unique codes', uniqueCodes(occurrences).size, EXPECT.codes);
  check('days', uniqueDays(occurrences).length, EXPECT.days);
  for (const [key, n] of Object.entries(EXPECT.perItem)) {
    const count = occurrences.filter((o) => o.code === key || o.title === key).length;
    check(`${key} occurrences`, count, n);
  }
  return failures;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const { slots, talks } = await loadInput();
  console.log(`Loaded ${slots.length} slots, ${talks.length} talks.`);

  const occurrences = expandOccurrences(slots, talks);
  const schedule: Schedule = { generatedAt: new Date().toISOString(), occurrences };

  console.log('Assertions:');
  const failures = assertInvariants(schedule);

  await writeFile(OUT, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${occurrences.length} occurrences → ${OUT}`);

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
