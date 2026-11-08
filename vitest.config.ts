import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig paths alias so imports like 'kit/signal' work in tests
      kit: resolve(__dirname, 'kit'),
    },
  },
  test: {
    // Collect tests from all *.test.ts files under test/
    include: ['test/**/*.test.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Generate text summary, lcov, and HTML reports
      reporter: ['text', 'lcov', 'html'],
      // Collect coverage from the whole kit/
      include: ['kit/**/*.ts'],
      exclude: ['kit/**/*.d.ts', 'kit/**/index.ts'],
      thresholds: {
        // Global minimums for all kit/ modules
        branches: 80,
        lines: 80,
        functions: 80,
        statements: 80,
        // Per-file 100% branch coverage for kit/signal/
        // Each signal module file must hit 100% branches
        perFile: true,
      },
    },
  },
});
