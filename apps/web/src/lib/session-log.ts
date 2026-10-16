import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sessionLogHeader } from '@chatbot/core';

/**
 * Folder for readable session logs (`CHAT_LOG_DIR`, relative to apps/web), or undefined when off.
 * Development only: the files hold the full, unmasked conversation, account numbers included.
 */
export function sessionLogDir(): string | undefined {
  const dir = process.env.CHAT_LOG_DIR;
  return dir && process.env.NODE_ENV === 'development' ? resolve(process.cwd(), dir) : undefined;
}

/** Appends to `<dir>/<sessionId>.md`, starting a new file with its header. Never throws. */
export function appendSessionLog(dir: string, sessionId: string, markdown: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sessionId}.md`);
    if (!existsSync(file)) appendFileSync(file, sessionLogHeader(sessionId));
    appendFileSync(file, markdown);
  } catch (err) {
    console.error('[session-log] could not write:', err);
  }
}
