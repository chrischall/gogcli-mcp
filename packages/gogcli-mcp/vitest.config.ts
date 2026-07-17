import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tests/worker.test.ts` only runs under the Workers runtime pool
    // (root `vitest.workers.config.mts` / `npm run worker:test`), which provides
    // the virtual `cloudflare:test` module it imports. The node pool must skip it.
    exclude: [...configDefaults.exclude, 'tests/worker.test.ts'],
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
