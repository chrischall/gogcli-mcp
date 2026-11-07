import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The places tests inject fetch, clock and cache path; nothing here may
    // reach Google or read a real key, so the ambient key vars are blanked.
    env: {
      GOG_PLACES_API_KEY: '',
      GOOGLE_PLACES_API_KEY: '',
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
