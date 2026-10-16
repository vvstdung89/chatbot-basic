import { updateBankInfoTool } from '../payment/bank-tool';
import { searchDocumentsTool, type KnowledgeBase } from '../rag/knowledge';
import type { ChatEvent, ChatProvider, ChatTool } from '../types';
import { createSummarizer, fitHistory } from './context';
import { buildSystemPrompt, withSystemPrompt } from './prompt';
import type { ChatRequest } from './validate';

export interface RunChatOptions {
  provider: ChatProvider;
  /** Documents for `search_documents`; the tool is offered only when there are files. */
  knowledge?: KnowledgeBase;
  /** Aborts summarizing, generation and tools, e.g. when the client disconnects. */
  signal?: AbortSignal;
}

/**
 * The chat pipeline for one request: keep the history within budget (summary event), build the
 * system prompt, offer the tools, stream the reply as text events. Events from tools are sent
 * before the next text chunk.
 *
 * Nothing is yielded until the provider has produced its first result, so a failure before the
 * reply (summarizing, invalid key, unknown model, ...) rejects the first `next()`.
 */
export async function* runChat(
  { messages, userInfo, pendingPayment }: ChatRequest,
  { provider, knowledge, signal }: RunChatOptions,
): AsyncGenerator<ChatEvent> {
  // Over the history budget, older messages are replaced by a summary (an extra LLM call).
  const { messages: kept, summary } = await fitHistory(
    messages.filter((m) => m.role !== 'system'),
    { summarize: createSummarizer(provider, signal) },
  );
  const prompt = buildSystemPrompt({ userInfo, summary: summary?.content, pendingPayment });

  const events: ChatEvent[] = summary ? [{ type: 'summary', ...summary }] : [];
  const tools: ChatTool[] = [
    ...(knowledge && knowledge.files().length > 0 ? [searchDocumentsTool(knowledge)] : []),
    updateBankInfoTool({
      pending: pendingPayment,
      onUpdate: (payment) => events.push({ type: 'payment', payment }),
    }),
  ];

  for await (const text of provider.streamChat(withSystemPrompt(kept, prompt), { signal, tools })) {
    yield* events.splice(0);
    yield { type: 'text', text };
  }
  yield* events.splice(0);
}
