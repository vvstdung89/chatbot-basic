import { join } from 'node:path';
import { getEmbedder, KnowledgeBase } from '@chatbot/core';

// Instrumentation and routes are bundled separately; share their index within this process.
const shared = globalThis as typeof globalThis & { chatbotKnowledge?: KnowledgeBase };

export const knowledge = (shared.chatbotKnowledge ??= new KnowledgeBase({
  dir: join(process.cwd(), 'knowledge'),
  embed: (texts, signal) => getEmbedder(process.env)(texts, signal),
}));
