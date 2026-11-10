import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: path.resolve(import.meta.dirname, '..'),
    include: ['e2e-firefox/*.spec.ts'],
    // Each test starts its own Firefox. Running them at once only adds contention.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
