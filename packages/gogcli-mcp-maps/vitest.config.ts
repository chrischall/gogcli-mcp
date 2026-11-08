import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every Google lookup goes through gog, and the tests hand the tools a
    // fake Spawner (tests/support/fake-maps.ts): no test may run the real gog,
    // which would bill a Places/Geocoding key.
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
