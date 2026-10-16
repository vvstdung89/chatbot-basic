import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// `pnpm test`: unit and component tests. e2e tests have their own config (vitest.e2e.config.ts).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'jsdom', exclude: [...configDefaults.exclude, 'e2e/**'] },
});
