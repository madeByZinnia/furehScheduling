import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  adaptConScheduleActivities,
  stripHtml,
  flattenCanfurence,
  buildTosRoomsById,
  type Activity,
} from './activities.ts';
import { expandOccurrences, type Occurrence } from '../../src/data/expand.ts';
import { CONS } from '../../src/data/cons.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, '__fixtures__', name), 'utf8')) as T;

// ── fixtures → normalized occurrences ────────────────────────────────────────

// Canfurence: day-grouped panels object → flat activities.
const cfPanels = readFixture<Record<string, Array<{ panels?: Activity[] }>>>('cf-panels.json');
const cfActivities = Object.values(cfPanels)
  .flat()
  .flatMap((d) => d.panels ?? []);
const cf = adaptConScheduleActivities(cfActivities, { con: CONS.canfurence });
const cfOcc = expandOccurrences(cf.slots, cf.talks, CONS.canfurence.tz);

// ToS: two flat arrays; resources → roomsById.
const tosActivities = readFixture<Activity[]>('tos-activities.json');
const tosResources = readFixture<Array<{ id: number | string; roomName?: string; title?: string }>>(
  'tos-resources.json',
);
const tosRoomsById = new Map(
  tosResources.map((r) => [String(r.id), r.roomName ?? r.title ?? ''] as const),
);
const tos = adaptConScheduleActivities(tosActivities, {
  con: CONS.tos,
  roomsById: tosRoomsById,
});
const tosOcc = expandOccurrences(tos.slots, tos.talks, CONS.tos.tz);

const byCode = (occ: Occurrence[], code: string) => occ.find((o) => o.code === code);

// ── specific real records ────────────────────────────────────────────────────

describe('Canfurence — Artist Lounge (activityID 318)', () => {
  const o = byCode(cfOcc, '318');
  it('normalizes offset, room, track and con-local day', () => {
    expect(o).toBeDefined();
    expect(o!.code).toBe('318');
    expect(o!.start).toBe('2026-08-08T08:00:00-04:00'); // offset appended
    expect(o!.room).toBe('304');
    expect(o!.track).toBe('Con Event Rooms');
    expect(o!.day).toBe('2026-08-08'); // America/Toronto bucket
  });
});

describe('Canfurence — a record WITH hosts (activityID 226)', () => {
  it('carries the host displayName through to the occurrence', () => {
    const o = byCode(cfOcc, '226');
    expect(o).toBeDefined();
    expect(o!.hosts).toContain('Anubis Tenebrous');
  });
});

describe('ToS — Hosting community technology (activityID 2)', () => {
  const o = byCode(tosOcc, '2');
  it('resolves room via resources, appends -07:00 offset, keeps track + host', () => {
    expect(o).toBeDefined();
    expect(o!.code).toBe('2');
    expect(o!.start.endsWith('-07:00')).toBe(true);
    expect(o!.room).toBe('Carvers - Panel 1'); // resourceId "1" → resources id 1
    expect(o!.track).toBe('Technology Track');
    expect(o!.hosts).toContain('Moose mower');
  });
});

// ── global invariants over BOTH cons' full fixtures ──────────────────────────

describe('global invariants (Canfurence + ToS)', () => {
  const all = [...cfOcc, ...tosOcc];
  const OFFSET = /[+-]\d{2}:\d{2}$/;

  it('(a) every start and end carries an explicit offset', () => {
    for (const o of all) {
      expect(OFFSET.test(o.start)).toBe(true);
      expect(OFFSET.test(o.end)).toBe(true);
    }
  });

  it('(b) occurrence ids are unique within each con', () => {
    expect(new Set(cfOcc.map((o) => o.id)).size).toBe(cfOcc.length);
    expect(new Set(tosOcc.map((o) => o.id)).size).toBe(tosOcc.length);
  });

  it('(c) no abstract contains a residual HTML tag', () => {
    const TAG = /<[a-z/]/i; // '<' followed by a letter or '/'
    for (const o of all) expect(TAG.test(o.abstract)).toBe(false);
  });
});

// ── stripHtml unit ───────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('removes tags, decodes entities, preserves paragraphs, collapses whitespace', () => {
    const html =
      '<p>Hello &amp; welcome</p><p>Line&nbsp;two &quot;quoted&quot;</p><div>Bye</div><br>done';
    const out = stripHtml(html);
    expect(out).toBe('Hello & welcome\n\nLine two "quoted"\n\nBye\n\ndone');
    // No residual HTML tags survive.
    expect(/<[a-z/]/i.test(out)).toBe(false);
  });

  it('returns empty string for empty / non-string input', () => {
    expect(stripHtml('')).toBe('');
    // @ts-expect-error — runtime guard for a non-string feed value.
    expect(stripHtml(null)).toBe('');
    // @ts-expect-error — runtime guard for a non-string feed value.
    expect(stripHtml(undefined)).toBe('');
  });

  it('drops <script>/<style> blocks including their contents', () => {
    expect(stripHtml('<script>alert(1)</script>')).toBe('');
    expect(stripHtml('before<style>.x{color:red}</style>after')).toBe('beforeafter');
    expect(stripHtml('keep<!-- secret -->this')).toBe('keepthis');
  });

  it('decodes numeric (decimal & hex) entities, then strips revealed tags', () => {
    // &#60;b&#62;hi&#60;/b&#62;  →  <b>hi</b>  →  hi
    expect(stripHtml('&#60;b&#62;hi&#60;/b&#62;')).toBe('hi');
    expect(stripHtml('&#x3c;b&#x3e;hi&#x3c;/b&#x3e;')).toBe('hi');
  });

  it('double-encoded entity that reveals a tag leaves no <tag> after final pass', () => {
    // &amp;lt;img&amp;gt; → &lt;img&gt; → <img> → (final strip) → ''
    const out = stripHtml('&amp;lt;img&amp;gt;');
    expect(/<[a-z/]/i.test(out)).toBe(false);
  });

  it('strips nested tags and leaves plain text unchanged', () => {
    expect(stripHtml('<div><span><b>deep</b></span></div>')).toBe('deep');
    expect(stripHtml('just plain text')).toBe('just plain text');
  });

  it('preserves literal comparison text and the <3 emoticon (not treated as tags)', () => {
    // The tag strip is anchored to a tag-like start (letter/!/ /), so `< 2` and
    // `<3` are kept while real/entity-revealed tags are still removed.
    expect(stripHtml('1 &lt; 2 and 3 &gt; 1')).toBe('1 < 2 and 3 > 1');
    expect(stripHtml('I &lt;3 you')).toBe('I <3 you');
    expect(stripHtml('ages 3 < 5 welcome')).toBe('ages 3 < 5 welcome');
    // ...but an entity-revealed real tag is still stripped.
    expect(stripHtml('&#60;b&#62;bold&#60;/b&#62;')).toBe('bold');
  });
});

// ── fix 1: offset detection / validation ─────────────────────────────────────

describe('withOffset (via adaptConScheduleActivities)', () => {
  const con = CONS.canfurence; // utcOffset '-04:00'
  const one = (start: string, end = start): Activity => ({ start, end, activityID: 1 });
  const firstSlot = (a: Activity) => adaptConScheduleActivities([a], { con }).slots[0]!;

  it('appends con.utcOffset to a bare YYYY-MM-DDTHH:MM:SS and it parses', () => {
    const s = firstSlot(one('2026-08-08T08:00:00')).start;
    expect(s).toBe('2026-08-08T08:00:00-04:00');
    expect(Number.isNaN(Date.parse(s))).toBe(false);
  });

  it('does NOT double-append onto an already-offset (Z) timestamp', () => {
    expect(firstSlot(one('2026-08-08T08:00:00Z')).start).toBe('2026-08-08T08:00:00Z');
    expect(firstSlot(one('2026-08-08T08:00:00+02:00')).start).toBe('2026-08-08T08:00:00+02:00');
  });

  it('throws on a date-only value (no T time)', () => {
    expect(() => adaptConScheduleActivities([one('2026-08-08')], { con })).toThrow(
      /unparseable timestamp/i,
    );
  });

  it('throws on junk trailing an otherwise offset-looking string', () => {
    expect(() => adaptConScheduleActivities([one('2026-08-08T08:00:00Zjunk')], { con })).toThrow(
      /unparseable timestamp/i,
    );
  });
});

// ── fix 3: ToS room fallback ─────────────────────────────────────────────────

describe('buildTosRoomsById', () => {
  it('falls back to title when roomName is empty', () => {
    const map = buildTosRoomsById([{ id: 1, roomName: '', title: 'Main Hall' }]);
    expect(map.get('1')).toBe('Main Hall');
  });
  it('prefers roomName when present', () => {
    const map = buildTosRoomsById([{ id: 2, roomName: 'Carvers', title: 'ignored' }]);
    expect(map.get('2')).toBe('Carvers');
  });
});

// ── fix 4: defensive Canfurence flatten ──────────────────────────────────────

describe('flattenCanfurence', () => {
  it('skips malformed days / slots / panels and keeps only start+end-bearing objects', () => {
    const malformed = {
      SAT: null, // day not an array
      FRI: [
        null,
        { panels: {} },
        { panels: [null, { title: 'no start' }, { start: '2026-08-08T10:00:00' /* no end */ }] },
      ],
      SUN: [
        {
          panels: [
            { start: '2026-08-08T10:00:00', end: '2026-08-08T11:00:00', activityID: 99, title: 'Real' },
          ],
        },
      ],
    };
    const acts = flattenCanfurence(malformed);
    // Only the fully-formed panel survives; the start-but-no-end one is skipped
    // (else withOffset(undefined) would throw downstream).
    expect(acts).toHaveLength(1);
    expect(acts[0]!.activityID).toBe(99);
  });

  it('returns [] for non-object input', () => {
    expect(flattenCanfurence(null)).toEqual([]);
    expect(flattenCanfurence('nope')).toEqual([]);
    expect(flattenCanfurence(42)).toEqual([]);
  });
});
