import {
  buildSystemPrompt,
  ChatRequestError,
  createSummarizer,
  fitHistory,
  formatPaymentInfo,
  getProvider,
  parseMessages,
  parsePendingPayment,
  parseUserInfo,
  resolvePendingPayment,
  searchDocumentsTool,
  type ChatMessage,
  type ChatProvider,
  type HistorySummary,
  type PaymentQrInfo,
  type PaymentStatus,
  type UserInfo,
  withPaymentStatus,
  withSummary,
  withSystemPrompt,
} from '@chatbot/core';
import { knowledge } from '@/lib/knowledge';

/**
 * POST /api/chat
 * Body: { messages: ChatMessage[], userInfo?: UserInfo, pendingPayment?: PaymentQrInfo }
 * Response: the assistant reply, streamed as plain UTF-8 text. The model may search the
 * knowledge documents (via tool calls) before replying. When older messages were summarized,
 * the X-Chat-Summary header holds encodeURIComponent(JSON.stringify({ count, content })).
 * With pendingPayment (QR details awaiting confirmation), the latest user message is classified;
 * when it confirms or declines, X-Payment-Update holds encodeURIComponent(JSON.stringify(status)).
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

  // QR payment details awaiting confirmation: classify the user's reply (an extra LLM call).
  let payment: PaymentStatus | undefined;
  if (pendingPayment) {
    const reply = messages.findLast((m) => m.role === 'user')?.content ?? '';
    try {
      payment = await resolvePendingPayment(provider, pendingPayment, reply, request.signal);
    } catch (err) {
      console.error(`[chat] ${provider.name} payment confirmation failed:`, err);
      payment = { status: 'pending', payment: formatPaymentInfo(pendingPayment) };
    }
    if (payment.status === 'confirmed') userInfo = { ...userInfo, payment: payment.payment };
  }

  const prompt = withSummary(buildSystemPrompt(userInfo), summary?.content);
  messages = withSystemPrompt(messages, withPaymentStatus(prompt, payment));

  // Wait for the first chunk so upstream failures (bad key, unknown model, rate limit)
  // become an HTTP error rather than a 200 response whose stream breaks.
  const tools = knowledge.files().length > 0 ? [searchDocumentsTool(knowledge)] : [];
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

  return new Response(toTextStream(first, chunks), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(summary && { 'X-Chat-Summary': encodeURIComponent(JSON.stringify(summary)) }),
      ...(payment &&
        payment.status !== 'pending' && {
          'X-Payment-Update': encodeURIComponent(JSON.stringify(payment)),
        }),
    },
  });
}

/** Pull-based so the provider only generates as fast as the client reads. */
function toTextStream(
  first: IteratorResult<string>,
  rest: AsyncIterator<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let pending: IteratorResult<string> | undefined = first;
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = pending ?? (await rest.next());
        pending = undefined;
        if (result.done) controller.close();
        else controller.enqueue(encoder.encode(result.value));
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
