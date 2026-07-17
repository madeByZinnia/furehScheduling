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
    const talksRes = await fetch(talksUrl);
    if (!talksRes.ok) throw new Error(`GET ${talksUrl} → HTTP ${talksRes.status}`);
    const raw = (await talksRes.json()) as { results?: RawTalk[] } | RawTalk[];
    const list = Array.isArray(raw) ? raw : (raw.results ?? []);
    const byCode = new Map(adapted.talks.map((t) => [t.code, t]));
    for (const t of list) if (t.code) byCode.set(t.code, { ...byCode.get(t.code), ...t });
    adapted.talks = [...byCode.values()];
  }
  return adapted;
}

// ── assertions ──────────────────────────────────────────────────────────────

interface Expectations {
  days: number;
  /** Exact occurrence count keyed by either a submission code or a title. */
  perItem: Record<string, number>;
  /** Sanity band for absolute totals — the feed is edited daily pre-con. */
  slotBand: [number, number];
  codeBand: [number, number];
}

// The convention schedule is a LIVE, daily-edited pretalx feed, so exact slot /
// code totals are a moving target (208/178 in the master plan → 207/177 on
// 2026-07-15 → 205/176 on 2026-07-16). Gating on an exact count would soon
// refuse to regenerate at all. So:
//   - Structural canaries stay EXACT — these encode the real invariants and
//     have held across every feed revision: 4 days, Registration → 5
//     occurrences (code 9JBJJY), CZKVLN → 4 (Wyndham Headless Lounge).
//   - Totals get a wide sanity BAND (catches a catastrophic parse/expansion
//     failure — 0 slots, or codes == slots meaning no expansion) without
//     breaking on routine edits.
const EXPECT: Expectations = {
  days: 4,
  perItem: { Registration: 5, CZKVLN: 4 },
  slotBand: [150, 260],
  codeBand: [140, 230],
};

function assertInvariants(schedule: Schedule): string[] {
  const { occurrences } = schedule;
  const failures: string[] = [];

  const checkEq = (name: string, actual: number, expected: number) => {
    const ok = actual === expected;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${actual} (expected ${expected})`);
    if (!ok) failures.push(`${name}: got ${actual}, expected ${expected}`);
  };
  const checkTrue = (name: string, ok: boolean, detail: string) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
    if (!ok) failures.push(`${name}: ${detail}`);
  };

  const slots = occurrences.length;
  const codes = uniqueCodes(occurrences).size;
  const ids = new Set(occurrences.map((o) => o.id)).size;

  // Expansion invariant: every slot is its own occurrence, ids are unique, and
  // codes genuinely collapsed (submissions repeat across slots).
  checkTrue('unique occurrence ids', ids === slots, `${ids} ids / ${slots} slots`);
  checkTrue('expansion happened (codes < slots)', codes < slots, `${codes} codes < ${slots} slots`);
  checkTrue(
    'slot count in band',
    slots >= EXPECT.slotBand[0] && slots <= EXPECT.slotBand[1],
    `${slots} in [${EXPECT.slotBand.join(', ')}]`,
  );
  checkTrue(
    'code count in band',
    codes >= EXPECT.codeBand[0] && codes <= EXPECT.codeBand[1],
    `${codes} in [${EXPECT.codeBand.join(', ')}]`,
  );

  checkEq('days', uniqueDays(occurrences).length, EXPECT.days);
  for (const [key, n] of Object.entries(EXPECT.perItem)) {
    const count = occurrences.filter((o) => o.code === key || o.title === key).length;
    checkEq(`${key} occurrences`, count, n);
  }
  return failures;
}

// ── main ────────────────────────────────────────────────────────────────────

/** Occurrence count in the currently committed schedule.json, or 0 if absent. */
async function previousOccurrenceCount(): Promise<number> {
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8')) as Partial<Schedule>;
    return Array.isArray(prev.occurrences) ? prev.occurrences.length : 0;
  } catch {
    return 0; // no prior file (or unreadable) → nothing to protect
  }
}

async function main() {
  const { slots, talks } = await loadInput();
  console.log(`Loaded ${slots.length} slots, ${talks.length} talks.`);

  const occurrences = expandOccurrences(slots, talks);
  const schedule: Schedule = { generatedAt: new Date().toISOString(), occurrences };

  console.log('Assertions:');
  const failures = assertInvariants(schedule);

  // Regression guard against truncation: the sanity band alone would admit a
  // structurally-plausible-but-truncated feed (e.g. a partial fetch). Compare
  // against the currently committed schedule and refuse a large drop. Self-
  // calibrating as the real schedule grows/shrinks; ALLOW_SHRINK=1 overrides
  // for a genuinely smaller schedule.
  const MAX_SHRINK = 0.15;
  const prevCount = await previousOccurrenceCount();
  // Compare against the exact float threshold (counts are integers) so the
  // boundary isn't loosened by rounding.
  if (prevCount > 0 && occurrences.length < prevCount * (1 - MAX_SHRINK)) {
    const msg = `occurrence count dropped from ${prevCount} to ${occurrences.length} (>${MAX_SHRINK * 100}%) — likely a truncated feed; set ALLOW_SHRINK=1 to override`;
    if (process.env.ALLOW_SHRINK === '1') {
      console.warn(`  WARN  shrink guard overridden: ${msg}`);
    } else {
      console.log(`  FAIL  shrink guard: ${msg}`);
      failures.push(`shrink guard: ${msg}`);
    }
  }

  // Do NOT write on failure — a changed/incomplete upstream feed must never
  // clobber the last known-good committed schedule.json just because the run
  // exited unsuccessfully. Only the validated schedule reaches disk.
  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) failed — schedule.json left unchanged:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  await writeFile(OUT, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${occurrences.length} occurrences → ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
