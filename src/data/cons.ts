/**
 * Con registry — pure data + types, NO I/O and NO browser/worker-only globals.
 *
 * This module is imported by BOTH the SPA (`src/app/*`) and the Worker
 * (`src/worker/*`), plus the build scripts, so it must stay environment-neutral:
 * no `window`, no `localStorage`, no `fetch`, no DOM. It is the single source of
 * truth that lets the previously single-con app run any of several cons from one
 * codebase.
 *
 * INVARIANT: Fureh's config reproduces the pre-multi-con hardcoded constants
 * EXACTLY. Every Fureh value below is copied verbatim from the file cited in its
 * trailing comment — see `src/data/cons.test.ts` for the assertions that pin it.
 */

export type ConId = 'fureh' | 'tos' | 'canfurence';

export interface ConConfig {
  id: ConId;
  /** Human display name; may include the year. */
  name: string;
  /** IANA timezone. */
  tz: string;
  /** Fixed UTC offset during the con, e.g. '-04:00'. */
  utcOffset: string;
  /** Con-local calendar bounds (YYYY-MM-DD, inclusive). */
  dates: { start: string; end: string };
  /** How the venue map is rendered. */
  mapMode: 'svg' | 'list';
  /** .ics export identity. */
  ics: { uidDomain: string; prodId: string; filename: string };
  /** localStorage namespace — equal to `id`. */
  storageKey: string;
  /** How a user imports their personal favourites, if at all. */
  favourites:
    | { mode: 'none' }
    | { mode: 'pretalx-paste'; sourceUrl: string }
    | { mode: 'cookie-paste'; cookieName: string; snippetHint: string };
  /** Where the schedule feed comes from and which adapter shape it is. */
  source:
    | { kind: 'frab'; scheduleUrl: string; talksUrl?: string }
    | {
        kind: 'con-activities';
        shape: 'canfurence-day-grouped' | 'tos-two-arrays';
        activitiesUrl: string;
        resourcesUrl?: string;
      };
  /** Ingest sanity gates (see scripts/fetch-schedule.ts EXPECT). */
  expectations: {
    days: number;
    slotBand: [number, number];
    codeBand: [number, number];
    /** True when submissions repeat across slots so uniqueCodes < slots. */
    expectExpansion: boolean;
    /** Exact per-code / per-title occurrence canaries. */
    perItem?: Record<string, number>;
  };
}

export const CONS: Record<ConId, ConConfig> = {
  fureh: {
    id: 'fureh',
    name: 'Fur-Eh 2026', // src/app/App.tsx <h1>
    tz: 'America/Edmonton', // src/data/expand.ts CON_TZ, src/app/datetime.ts TZ, src/worker/digest.ts CON_TZ
    utcOffset: '-06:00',
    dates: { start: '2026-07-16', end: '2026-07-19' },
    mapMode: 'svg',
    ics: {
      uidDomain: 'fureh-schedules', // src/app/ics.ts UID_DOMAIN
      prodId: '-//fureh-schedules//Fur-Eh 2026 Schedule//EN', // src/app/ics.ts DEFAULT_PRODID
      filename: 'fureh-2026.ics', // src/app/MeExport.tsx FILENAME
    },
    storageKey: 'fureh', // src/app/stars.ts KEY prefix ('fureh' in 'fureh.stars.v1')
    favourites: {
      mode: 'pretalx-paste',
      // src/app/MeImport.tsx FAVOURITES_URL
      sourceUrl: 'https://events.fureh.ca/api/events/2026/submissions/favourites/',
    },
    source: {
      kind: 'frab',
      // scripts/fetch-schedule.ts default PRETALX_SCHEDULE_URL
      scheduleUrl: 'https://events.fureh.ca/2026/schedule/export/schedule.json',
    },
    // Translated from scripts/fetch-schedule.ts EXPECT (lines ~180-185). Fureh
    // repeats sessions across slots, so codes < slots → expectExpansion:true.
    expectations: {
      days: 4,
      slotBand: [150, 260],
      codeBand: [140, 230],
      expectExpansion: true,
      perItem: { Registration: 5, CZKVLN: 4 },
    },
  },
  canfurence: {
    id: 'canfurence',
    name: 'Canfurence 2026',
    tz: 'America/Toronto',
    utcOffset: '-04:00',
    dates: { start: '2026-08-07', end: '2026-08-09' },
    mapMode: 'list',
    ics: {
      uidDomain: 'canfurence.ca',
      prodId: '-//fureh-schedules//Canfurence 2026 Schedule//EN',
      filename: 'canfurence-2026.ics',
    },
    storageKey: 'canfurence',
    favourites: { mode: 'none' },
    source: {
      kind: 'con-activities',
      shape: 'canfurence-day-grouped',
      activitiesUrl: 'https://canfurence.ca/backend/schedule/panels',
    },
    // Placeholder bands — Tic 2 (real ingest against the live feed) will tighten
    // these to observed slot/code totals and add per-item canaries.
    expectations: {
      days: 4,
      slotBand: [100, 400],
      codeBand: [100, 400],
      expectExpansion: false,
    },
  },
  tos: {
    id: 'tos',
    name: 'Tails of Summer 2026',
    tz: 'America/Vancouver',
    utcOffset: '-07:00',
    dates: { start: '2026-08-08', end: '2026-08-09' },
    mapMode: 'list',
    ics: {
      uidDomain: 'tailsofsummer.com',
      prodId: '-//fureh-schedules//Tails of Summer 2026 Schedule//EN',
      filename: 'tails-of-summer-2026.ics',
    },
    storageKey: 'tos',
    favourites: {
      mode: 'cookie-paste',
      cookieName: 'HOWL_24',
      snippetHint: 'On tailsofsummer.com run: document.cookie.match(/HOWL_24=([^;]*)/)?.[1]',
    },
    source: {
      kind: 'con-activities',
      shape: 'tos-two-arrays',
      activitiesUrl: 'https://tailsofsummer.com/tos-schedule/api_proxy.php?target=activities',
      resourcesUrl: 'https://tailsofsummer.com/tos-schedule/api_proxy.php?target=resources',
    },
    // Placeholder bands — Tic 2 (real ingest against the live feed) will tighten
    // these to observed slot/code totals and add per-item canaries.
    expectations: {
      days: 2,
      slotBand: [50, 300],
      codeBand: [50, 300],
      expectExpansion: false,
    },
  },
};

export const DEFAULT_CON: ConId = 'fureh';

/** Validated lookup: returns the config for a known id, or null on anything else. */
export function getCon(id: string): ConConfig | null {
  return Object.prototype.hasOwnProperty.call(CONS, id) ? CONS[id as ConId] : null;
}
