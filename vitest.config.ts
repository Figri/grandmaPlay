import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'server/test/**/*.test.ts', 'client/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
