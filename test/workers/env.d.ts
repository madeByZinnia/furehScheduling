/// <reference types="@cloudflare/vitest-pool-workers" />
import type { Env } from '../../src/worker/env';

declare module 'cloudflare:test' {
  // Types `env` (and bindings) from cloudflare:test to the Worker's real Env.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
