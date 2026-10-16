import {
  buildSystemPrompt,
  ChatRequestError,
  createSummarizer,
  fitHistory,
  getProvider,
  parseMessages,
  parsePendingPayment,
  parseUserInfo,
  searchDocumentsTool,
  updateBankInfoTool,
  type ChatEvent,
  type ChatMessage,
  type ChatProvider,
  type HistorySummary,
  type PaymentQrInfo,
  type UserInfo,
  withPendingPayment,
  withSummary,
  withSystemPrompt,
} from '@chatbot/core';
import { knowledge } from '@/lib/knowledge';

/**
 * POST /api/chat
 * Body: { messages: ChatMessage[], userInfo?: UserInfo, pendingPayment?: PaymentQrInfo }
 * Response: NDJSON, one ChatEvent per line: "summary" (older messages were summarized), "text"
 * (reply chunks) and "payment" (update_bank_info saved new User Payment text). The model may call
 * tools (search_documents, update_bank_info) while replying; pendingPayment holds QR details
 * awaiting the user's confirmation.
 * Errors: { error: string } with 400 (bad request), 500 (misconfigured), 502 (provider failed).
 */
export async function POST(request: Request): Promise<Response> {
  let messages: ChatMessage[];
  let userInfo: UserInfo;
  let pendingPayment: PaymentQrInfo | undefined;
  try {
    const body: unknown = await request.json();
    messages = parseMessages(body);
    userInfo = parseUserInfo(body);
    pendingPayment = parsePendingPayment(body);
  } catch (err) {
    const error = err instanceof ChatRequestError ? err.message : 'Body must be valid JSON';
    return Response.json({ error }, { status: 400 });
  }

  let provider: ChatProvider;
  try {
    provider = getProvider(process.env);
  } catch (err) {
    console.error('[chat] provider config error:', err);
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }

  // Over the history budget, older messages are replaced by a summary (an extra LLM call).
  let summary: HistorySummary | undefined;
  try {
    const history = messages.filter((m) => m.role !== 'system');
    ({ messages, summary } = await fitHistory(history, {
      summarize: createSummarizer(provider, request.signal),
    }));
  } catch (err) {
    console.error(`[chat] ${provider.name} summary failed:`, err);
    return Response.json({ error: `${provider.name}: ${errorMessage(err)}` }, { status: 502 });
  }

  const prompt = withSummary(buildSystemPrompt(userInfo), summary?.content);
  messages = withSystemPrompt(messages, withPendingPayment(prompt, pendingPayment));

  // Tools run while the reply streams; their events are sent before the next text chunk.
  const events: ChatEvent[] = summary ? [{ type: 'summary', ...summary }] : [];
  const tools = [
    ...(knowledge.files().length > 0 ? [searchDocumentsTool(knowledge)] : []),
    updateBankInfoTool({
      pending: pendingPayment,
      onUpdate: (payment) => events.push({ type: 'payment', payment }),
    }),
  ];

  // Wait for the first chunk so upstream failures (bad key, unknown model, rate limit)
  // become an HTTP error rather than a 200 response whose stream breaks.
  const chunks = provider
    .streamChat(messages, { signal: request.signal, tools })
    [Symbol.asyncIterator]();
  let first: IteratorResult<string>;
  try {
    first = await chunks.next();
  } catch (err) {
    console.error(`[chat] ${provider.name} failed:`, err);
    return Response.json({ error: `${provider.name}: ${errorMessage(err)}` }, { status: 502 });
  }

  return new Response(toEventStream(events, first, chunks), {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Pull-based so the provider only generates as fast as the client reads. Events queued by tools
 * while a chunk was produced are sent before that chunk, in order.
 */
function toEventStream(
  events: ChatEvent[],
  first: IteratorResult<string>,
  rest: AsyncIterator<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const line = (event: ChatEvent) => encoder.encode(`${JSON.stringify(event)}\n`);
  let next: IteratorResult<string> | undefined = first;
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = next ?? (await rest.next());
        next = undefined;
        for (const event of events.splice(0)) controller.enqueue(line(event));
        if (result.done) controller.close();
        else controller.enqueue(line({ type: 'text', text: result.value }));
      } catch (err) {
        console.error('[chat] stream failed:', err);
        controller.error(err);
      }
    },
    async cancel() {
      await rest.return?.();
    },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
