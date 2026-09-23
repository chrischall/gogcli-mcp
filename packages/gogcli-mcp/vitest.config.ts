import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
      // The arg-shape tests pass arbitrary server paths (/tmp/shot.png,
      // /path/to/file); confinement is exercised explicitly by the tests that
      // narrow GOG_FILE_ROOTS themselves (tests/file-roots.test.ts and the
      // per-tool "refuses a path outside" cases).
      GOG_FILE_ROOTS: '/',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
