import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/generated/**'],
      thresholds: {
        // Thresholds apply to the use-case ring (see node-clean-architecture).
        // Tighten as modules land in Fase 2+.
        lines: 60,
        statements: 60,
      },
    },
  },
});
