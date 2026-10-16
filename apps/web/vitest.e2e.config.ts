import { defineConfig } from 'vitest/config';

// `pnpm test:e2e`: against the production build (`pnpm build` first), see e2e/server.ts.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    environment: 'node',
    globalSetup: './e2e/server.ts',
    testTimeout: 30_000,
  },
});
