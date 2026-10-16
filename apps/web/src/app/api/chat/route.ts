import {
  ChatRequestError,
  encodeChatEvent,
  getProvider,
  parseChatRequest,
  runChat,
  type ChatEvent,
  type ChatProvider,
  type ChatRequest,
} from '@chatbot/core';
import { knowledge } from '@/lib/knowledge';

/**
 * POST /api/chat
 * Body: { messages: ChatMessage[], userInfo?: UserInfo, pendingPayment?: PaymentQrInfo }
 * Response: NDJSON, one ChatEvent per line: "summary" (older messages were summarized), "text"
 * (reply chunks) and "payment" (update_bank_info saved new User Payment text). The pipeline is
 * runChat in @chatbot/core; this route only does HTTP.
 * Errors: { error: string } with 400 (bad request), 500 (misconfigured), 502 (provider failed).
 */
export async function POST(request: Request): Promise<Response> {
  let chat: ChatRequest;
  try {
    chat = parseChatRequest(await request.json());
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

  // runChat yields nothing until the provider replied, so upstream failures (bad key, unknown
  // model, rate limit, summary failure) become an HTTP error rather than a broken 200 stream.
  const events = runChat(chat, { provider, knowledge, signal: request.signal });
  let first: IteratorResult<ChatEvent>;
  try {
    first = await events.next();
  } catch (err) {
    console.error(`[chat] ${provider.name} failed:`, err);
    return Response.json({ error: `${provider.name}: ${errorMessage(err)}` }, { status: 502 });
  }

  return new Response(toNdjsonStream(first, events), {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** Pull-based so the provider only generates as fast as the client reads. */
function toNdjsonStream(
  first: IteratorResult<ChatEvent>,
  rest: AsyncIterator<ChatEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let next: IteratorResult<ChatEvent> | undefined = first;
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = next ?? (await rest.next());
        next = undefined;
        if (result.done) controller.close();
        else controller.enqueue(encoder.encode(encodeChatEvent(result.value)));
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
