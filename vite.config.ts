import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Vitest config lives here too (see `test`). The Cloudflare workers pool runs
// as a separate project via vitest.workers.config.ts once Worker code exists.
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    },
  },
});
