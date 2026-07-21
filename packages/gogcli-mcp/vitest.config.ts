import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tests/worker.test.ts` only runs under the Workers runtime pool
    // (root `vitest.workers.config.mts` / `npm run worker:test`), which provides
    // the virtual `cloudflare:test` module it imports. The node pool must skip it.
    exclude: [...configDefaults.exclude, 'tests/worker.test.ts'],
    // Neutralize the gog env vars for the whole suite.
    //
    // THE BUG THIS FIXES: the runner tests assert the exact argv `run()` builds,
    // but `run()` reads GOG_ACCOUNT/GOG_PATH/GOG_READONLY from the ambient
    // environment. Anyone whose shell exports them — which is normal for a
    // machine that also *uses* these MCP servers — got 10+ failures on an
    // untouched working tree, and the vitest diff dumped the entire process.env
    // (live API keys included) into the terminal. CI passed only because its
    // environment happens to be bare.
    //
    // Empty string rather than deletion: vitest's `env` merges into process.env
    // and cannot unset a key, but `readEnvVar` already treats '' as unset (the
    // same rule that makes blank .mcpb user-config fields behave as absent), so
    // this is exactly equivalent to running with the vars removed.
    env: {
      GOG_ACCOUNT: '',
      GOG_PATH: '',
      GOG_READONLY: '',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        // src/worker.ts is the only Worker-path file that can't load under the
        // node pool (it imports the `@chrischall/mcp-connector`/`agents` runtime);
        // it's exercised by the Workers pool suite (`npm run worker:test`). Its
        // testable helpers live in src/connector-runtime.ts, and src/connector-auth.ts
        // is node-loadable — both are unit-tested here and stay in the 100% gate.
        'src/worker.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
