import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Smoke test proving the workerd pool is wired up. Real DO/alarm tests attach
// here in M2.
describe('worker (workerd pool)', () => {
  it('answers the health check', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
