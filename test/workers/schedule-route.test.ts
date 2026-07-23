import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Schedule } from '../../src/data/expand';

// This suite exercises GET /api/schedule against the REAL boundaries the pool
// provides:
//   - env.SCHEDULES: a real miniflare-backed KV namespace (from wrangler.jsonc's
//     kv_namespaces), so the KV-first read path is genuine, not stubbed.
//   - env.ASSETS: a real workerd assets worker serving ./public (overridden in
//     vitest.workers.config.ts, since ./dist/ isn't built in the worktree). The
//     generated public/data/<con>.json feeds are the actual fallback bytes.
//
// The assertions are DISCRIMINATIVE: a mutation that always reads the asset fails
// the KV-wins test; a mutation with no asset fallback fails the empty-KV test.
//
// COVERAGE BOUNDARY: handleSchedule's content-type guard (rejecting a non-JSON
// asset body) exists for the PROD assets binding, where not_found_handling:
// single-page-application makes a MISSING file resolve to index.html at HTTP 200.
// The test pool serves ./public with no index.html, so a missing asset already
// 404s via !res.ok — the html-shell-at-200 branch cannot be reproduced here and
// is verified by construction, not by a pool test.

// Unique marker so the KV-wins assertion cannot accidentally match the real
// asset's generatedAt.
const SENTINEL = 'SENTINEL-kv-wins-7f3a91';

function url(con: string): string {
  return `https://example.com/api/schedule?con=${encodeURIComponent(con)}`;
}

// Clear the KV key each test so KV-hit and KV-miss cases don't leak into each
// other (the pool's KV persists within a worker instance across tests).
beforeEach(async () => {
  await env.SCHEDULES.delete('tos');
  await env.SCHEDULES.delete('canfurence');
});

describe('GET /api/schedule — KV-first, asset fallback', () => {
  it('KV WINS: a live KV value overrides the baked asset', async () => {
    // Plain object (not the branded `Schedule` type): what we PUT into KV is raw
    // JSON, which carries no ItemCode/OccurrenceId brands.
    const live = {
      generatedAt: SENTINEL,
      occurrences: [
        {
          id: 'LIVE@2026-08-08T10:00:00-07:00',
          code: 'LIVE',
          title: 'Live override',
          abstract: '',
          track: null,
          room: null,
          start: '2026-08-08T10:00:00-07:00',
          end: '2026-08-08T11:00:00-07:00',
          day: '2026-08-08',
        },
      ],
    };
    await env.SCHEDULES.put('tos', JSON.stringify(live));

    const res = await SELF.fetch(url('tos'));
    expect(res.status).toBe(200);
    const body = await res.json<Schedule>();
    // The response MUST be the KV value, never the asset's schedule.
    expect(body.generatedAt).toBe(SENTINEL);
    expect(body.occurrences[0]!.code).toBe('LIVE');
  });

  it('empty-KV fallback: with no KV key, serves the baked static asset', async () => {
    // No KV key for `tos` (cleared in beforeEach) → must fall back to the real
    // /data/tos.json asset, which has a non-empty occurrences array and is NOT
    // the sentinel.
    const res = await SELF.fetch(url('tos'));
    expect(res.status).toBe(200);
    const body = await res.json<Schedule>();
    expect(Array.isArray(body.occurrences)).toBe(true);
    expect(body.occurrences.length).toBeGreaterThan(0);
    expect(body.generatedAt).not.toBe(SENTINEL);
  });

  it('fallback is CON-SPECIFIC: canfurence serves its own asset, not tos', async () => {
    // Kills an "always fetch /data/tos.json on KV miss" mutation: canfurence's
    // real asset uses the Toronto offset (-04:00), tos uses Pacific (-07:00).
    const res = await SELF.fetch(url('canfurence'));
    expect(res.status).toBe(200);
    const body = await res.json<Schedule>();
    expect(body.occurrences.length).toBeGreaterThan(0);
    expect(body.occurrences.every((o) => o.start.endsWith('-04:00'))).toBe(true);

    // ...and tos still serves the Pacific-offset asset.
    const tos = await (await SELF.fetch(url('tos'))).json<Schedule>();
    expect(tos.occurrences.every((o) => o.start.endsWith('-07:00'))).toBe(true);
  });

  it('unknown con → 404', async () => {
    const res = await SELF.fetch(url('zzz'));
    expect(res.status).toBe(404);
  });

  it('missing con query param → 404', async () => {
    const res = await SELF.fetch('https://example.com/api/schedule');
    expect(res.status).toBe(404);
  });

  it('successful response carries Cache-Control max-age=60 (both KV and asset paths)', async () => {
    // Asset path.
    const assetRes = await SELF.fetch(url('tos'));
    expect(assetRes.headers.get('cache-control')).toContain('max-age=60');

    // KV path.
    await env.SCHEDULES.put('tos', JSON.stringify({ generatedAt: SENTINEL, occurrences: [] }));
    const kvRes = await SELF.fetch(url('tos'));
    expect(kvRes.headers.get('cache-control')).toContain('max-age=60');
  });
});
