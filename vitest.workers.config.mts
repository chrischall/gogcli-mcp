import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Runs `packages/gogcli-mcp/tests/worker.test.ts` inside the real Workers
// runtime (via Miniflare), against `wrangler.jsonc`'s bindings (the
// `GogcliMcpAgent` Durable Object + `OAUTH_KV` + `FLY_ENDPOINT` var). Kept
// separate from the stdio suites' per-package `vitest.config.ts` / `npm test`,
// which run under Node and never touch this file.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['packages/gogcli-mcp/tests/worker.test.ts'],
  },
});
