/**
 * fetch-schedule.ts — multi-con schedule ingest.
 *
 * Run via `npm run schedule:<con>` (tsx). Picks a source adapter by con config,
 * normalizes the upstream feed into flat slot + talk lists, expands every slot
 * into its own stable occurrence (see src/data/expand.ts) in the con's
 * timezone, asserts that con's invariants, and writes public/data/<con>.json.
 *
 * USAGE:
 *   tsx scripts/fetch-schedule.ts --con <fureh|tos|canfurence>   (default fureh)
 *
 * INPUT per con is declared in src/data/cons.ts (`source`). The frab/pretalx
 * path additionally honors:
 *   PRETALX_SCHEDULE_URL   frab/pretalx schedule.json (overrides con.scheduleUrl)
 *   PRETALX_TALKS_URL      pretalx talks API (abstract/track enrichment), optional
 *   --fixture <path>       local JSON in the same shape (offline)
 */

import { writeFile, readFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  expandOccurrences,
  uniqueCodes,
  uniqueDays,
  type Schedule,
} from '../src/data/expand.ts';
import { getCon, DEFAULT_CON, type ConConfig } from '../src/data/cons.ts';
import { fetchFrab } from './adapters/frab.ts';
import { fetchCanfurence, fetchTos } from './adapters/activities.ts';
import type { SourceAdapter, AdapterContext } from './adapters/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../public/data');

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const val = process.argv[i + 1];
  if (val === undefined) throw new Error(`${name} requires a value`);
  return val;
}

/** Resolve the con's adapter from its source kind / shape. */
function adapterFor(con: ConConfig): SourceAdapter {
  const source = con.source;
  if (source.kind === 'frab') return fetchFrab;
  switch (source.shape) {
    case 'canfurence-day-grouped':
      return fetchCanfurence;
    case 'tos-two-arrays':
      return fetchTos;
    default:
      // Exhaustive: a new kind/shape reaches here as a loud, specific error
      // instead of returning undefined ("adapter is not a function") downstream.
      throw new Error(
        `unknown source shape: ${JSON.stringify({ kind: source.kind, shape: source.shape })}`,
      );
  }
}

// ── assertions (pluggable against con.expectations) ──────────────────────────

function assertInvariants(schedule: Schedule, con: ConConfig): string[] {
  const { occurrences } = schedule;
  const { expectations } = con;
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

  // Structural: one occurrence per id, and totals within the sanity band.
  checkTrue('unique occurrence ids', ids === slots, `${ids} ids / ${slots} slots`);
  checkTrue(
    'slot count in band',
    slots >= expectations.slotBand[0] && slots <= expectations.slotBand[1],
    `${slots} in [${expectations.slotBand.join(', ')}]`,
  );
  checkTrue(
    'code count in band',
    codes >= expectations.codeBand[0] && codes <= expectations.codeBand[1],
    `${codes} in [${expectations.codeBand.join(', ')}]`,
  );

  // Expansion invariant only where sessions genuinely repeat across slots.
  if (expectations.expectExpansion) {
    checkTrue(
      'expansion happened (codes < slots)',
      codes < slots,
      `${codes} codes < ${slots} slots`,
    );
  }

  checkEq('days', uniqueDays(occurrences).length, expectations.days);

  // Content canary: a feed can pass every count/id/day gate while being gutted
  // of titles (e.g. a schema shift that empties the field). Require ≥90% of
  // occurrences to carry a non-empty title.
  const titled = occurrences.filter((o) => o.title.trim() !== '').length;
  const titledPct = slots === 0 ? 0 : titled / slots;
  checkTrue(
    'titles present (≥90%)',
    titledPct >= 0.9,
    `${titled}/${slots} titled (${(titledPct * 100).toFixed(1)}%)`,
  );

  // Per-item canaries only when the con declares them.
  if (expectations.perItem) {
    for (const [key, n] of Object.entries(expectations.perItem)) {
      const count = occurrences.filter((o) => o.code === key || o.title === key).length;
      checkEq(`${key} occurrences`, count, n);
    }
  }
  return failures;
}

// ── main ────────────────────────────────────────────────────────────────────

/** Occurrence count in the currently committed per-con file, or 0 if absent. */
async function previousOccurrenceCount(outPath: string): Promise<number> {
  try {
    const prev = JSON.parse(await readFile(outPath, 'utf8')) as Partial<Schedule>;
    return Array.isArray(prev.occurrences) ? prev.occurrences.length : 0;
  } catch {
    return 0; // no prior file (or unreadable) → nothing to protect
  }
}

async function main() {
  const conId = parseFlag('--con') ?? DEFAULT_CON;
  const con = getCon(conId);
  if (!con) throw new Error(`unknown con '${conId}'`);

  const fixturePath = parseFlag('--fixture');
  const ctx: AdapterContext = { con, ...(fixturePath ? { fixturePath } : {}) };
  const adapter = adapterFor(con);

  const { slots, talks } = await adapter(ctx);
  console.log(`[${con.id}] Loaded ${slots.length} slots, ${talks.length} talks.`);

  const occurrences = expandOccurrences(slots, talks, con.tz);
  const schedule: Schedule = { generatedAt: new Date().toISOString(), occurrences };

  console.log('Assertions:');
  const failures = assertInvariants(schedule, con);

  const outPath = resolve(DATA_DIR, `${con.id}.json`);

  // Regression guard against truncation: the sanity band alone would admit a
  // structurally-plausible-but-truncated feed (e.g. a partial fetch). Compare
  // against the currently committed per-con file and refuse a large drop.
  // ALLOW_SHRINK=1 overrides for a genuinely smaller schedule.
  const MAX_SHRINK = 0.15;
  const prevCount = await previousOccurrenceCount(outPath);
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
  // clobber the last known-good committed file just because the run exited
  // unsuccessfully. Only the validated schedule reaches disk.
  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) failed — ${con.id}.json left unchanged:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  // Atomic write: stage to a sibling .tmp then rename over the target, so a
  // mid-write crash can never truncate the last known-good per-con file.
  await mkdir(DATA_DIR, { recursive: true });
  const tmpPath = `${outPath}.${process.pid}.tmp`; // pid-unique: no clobber on concurrent runs
  await writeFile(tmpPath, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
  await rename(tmpPath, outPath);
  console.log(`Wrote ${occurrences.length} occurrences → ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
