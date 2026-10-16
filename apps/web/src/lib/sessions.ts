import { MemorySessionStore, type Session } from '@chatbot/core';

// Routes are bundled separately; share one in-memory store within this process.
const shared = globalThis as typeof globalThis & { chatbotSessions?: MemorySessionStore };

export const sessions = (shared.chatbotSessions ??= new MemorySessionStore());

/** What the browser gets: the conversation to display, never the pending bank details. */
export function sessionView({ id, messages, userInfo, summary }: Session) {
  return { sessionId: id, messages, userInfo, ...(summary && { summary }) };
}
