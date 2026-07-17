import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Separate project for tests that must run in the real `workerd` runtime
// (Durable Objects, alarms, SQLite storage). Run with `npm run test:workers`.
export default defineWorkersConfig({
  test: {
    include: ['test/workers/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        // Dummy secret for the pool — the real BOT_TOKEN is a deployed secret and
        // never lives in the repo. Telegram calls are stubbed in the tests.
        miniflare: {
          bindings: {
            BOT_TOKEN: 'test-bot-token',
            WEBHOOK_SECRET: 'test-webhook-secret',
            SETUP_KEY: 'test-setup-key',
          },
        },
      },
    },
  },
});
