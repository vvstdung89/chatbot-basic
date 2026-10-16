import { updateBankInfoTool } from '../payment/bank-tool';
import { searchDocumentsTool, type KnowledgeBase } from '../rag/knowledge';
import type { ChatEvent, ChatProvider, ChatTool } from '../types';
import { createSummarizer, fitHistory } from './context';
import { buildSystemPrompt, withSystemPrompt } from './prompt';
import { emitTrace, type TraceCallback } from './trace';
import type { UserInfo } from './user-info';
import type { PaymentQrInfo } from '../payment/vietqr';
import type { ChatMessage } from '../types';

/** What one reply is based on: the conversation so far and the user's stored data. */
export interface ChatRequest {
  messages: ChatMessage[];
  userInfo: UserInfo;
  /** Bank details waiting for the user's confirmation. */
  pendingPayment?: PaymentQrInfo;
}

export interface RunChatOptions {
  onTrace?: TraceCallback;
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
  { provider, knowledge, signal, onTrace }: RunChatOptions,
): AsyncGenerator<ChatEvent> {
  emitTrace(onTrace, { type: 'history.start', messages: messages.length });
  // Over the history budget, older messages are replaced by a summary (an extra LLM call).
  const { messages: kept, summary } = await fitHistory(
    messages.filter((m) => m.role !== 'system'),
    { summarize: createSummarizer(provider, signal, onTrace) },
  );
  emitTrace(onTrace, {
    type: 'history.ready',
    messages: kept.length,
    summarized: summary?.count ?? 0,
  });
  const prompt = buildSystemPrompt({ userInfo, summary: summary?.content, pendingPayment });

  const events: ChatEvent[] = summary ? [{ type: 'summary', ...summary }] : [];
  const tools: ChatTool[] = [
    ...(knowledge && knowledge.files().length > 0 ? [searchDocumentsTool(knowledge, onTrace)] : []),
    updateBankInfoTool({
      pending: pendingPayment,
      onPropose: (pending) => events.push({ type: 'pending_payment', pending }),
      onConfirm: (payment) => events.push({ type: 'payment', payment }),
      onCancel: () => events.push({ type: 'pending_payment', pending: null }),
    }),
  ];

  if (onTrace) {
    // Bank sections stay private even with development content capture enabled.
    const debugPrompt = buildSystemPrompt({
      userInfo: { ...userInfo, payment: userInfo.payment ? '[redacted]' : undefined },
      summary: summary?.content,
    });
    emitTrace(onTrace, {
      type: 'prompt.ready',
      characters: prompt.length,
      tools: tools.map((tool) => tool.name),
      pendingPayment: Boolean(pendingPayment),
      content: { messages: withSystemPrompt(kept, debugPrompt) },
    });
  }
  let firstText = true;
  for await (const text of provider.streamChat(withSystemPrompt(kept, prompt), {
    signal,
    tools,
    onTrace,
  })) {
    if (firstText) {
      emitTrace(onTrace, { type: 'response.first_text' });
      firstText = false;
    }
    yield* events.splice(0);
    yield { type: 'text', text };
  }
  yield* events.splice(0);
}
