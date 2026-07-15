import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Separate project for tests that must run in the real `workerd` runtime
// (Durable Objects, alarms, storage). Kept out of the default `npm test` until
// Worker code lands in M2 — run explicitly with `npm run test:workers`.
export default defineWorkersConfig({
  test: {
    include: ['test/workers/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
