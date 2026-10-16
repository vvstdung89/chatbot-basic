// Vitest global setup for e2e tests: serves the production build (`pnpm build` first) with the
// echo provider, so the tests need no API key and cost nothing.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const E2E_PORT = 3999;
const appDir = fileURLToPath(new URL('..', import.meta.url));

export default async function setup() {
  if (!existsSync(new URL('../.next/BUILD_ID', import.meta.url))) {
    throw new Error('No production build: run `pnpm build` before `pnpm test:e2e`.');
  }
  const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
  const server = spawn(process.execPath, [next, 'start', '-p', String(E2E_PORT)], {
    cwd: appDir,
    env: { ...process.env, CHAT_PROVIDER: 'echo' },
    stdio: 'ignore',
  });

  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://localhost:${E2E_PORT}/`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (i === 60) throw new Error('Next server did not start');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return () => {
    server.kill();
  };
}
