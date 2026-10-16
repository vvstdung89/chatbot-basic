import {
  ChatRequestError,
  chatTurn,
  createSessionLog,
  createTrace,
  emitTrace,
  encodeChatEvent,
  getProvider,
  parseChatTurn,
  SessionBusyError,
  type ChatEvent,
  type ChatProvider,
  type ChatTurnRequest,
} from '@chatbot/core';
import { knowledge } from '@/lib/knowledge';
import { appendSessionLog, sessionLogDir } from '@/lib/session-log';
import { sessions } from '@/lib/sessions';

/**
 * POST /api/chat
 * Body: { sessionId?, message } — the conversation itself is kept on the server.
 * Response: NDJSON, one ChatEvent per line: "session" (always first), "summary" (older messages
 * were summarized), "text" (reply chunks) and "payment" (update_bank_info saved new User Payment
 * text). The pipeline is chatTurn / runChat in @chatbot/core; this route only does HTTP.
 * Errors: { error: string } with 400 (bad request), 409 (a reply for this session is already in
 * progress), 500 (misconfigured), 502 (provider failed).
 */
export async function POST(request: Request): Promise<Response> {
  // Session log files (CHAT_LOG_DIR, development) replace the terminal JSON trace (CHAT_DEBUG).
  const logDir = sessionLogDir();
  const requestId = logDir || process.env.CHAT_DEBUG === '1' ? crypto.randomUUID() : undefined;
  const headers: Record<string, string> = requestId ? { 'X-Request-Id': requestId } : {};
  const onTrace = !requestId
    ? undefined
    : logDir
      ? createSessionLog({
          requestId,
          write: (sessionId, markdown) => appendSessionLog(logDir, sessionId, markdown),
        })
      : createTrace({
          requestId,
          captureContent:
            process.env.CHAT_DEBUG_CONTENT === '1' && process.env.NODE_ENV === 'development',
          write: (line) => console.info(line),
        });
  let ended = false;
  const finish = (type: string, status?: number, error?: unknown) => {
    if (ended) return;
    ended = true;
    request.signal.removeEventListener('abort', aborted);
    emitTrace(onTrace, {
      type,
      status,
      ...(error !== undefined && { content: { error: errorMessage(error) } }),
    });
  };
  const aborted = () => finish('request.abort');
  emitTrace(onTrace, { type: 'request.start' });
  request.signal.addEventListener('abort', aborted, { once: true });
  if (request.signal.aborted) aborted();

  let turn: ChatTurnRequest;
  try {
    turn = parseChatTurn(await request.json());
  } catch (err) {
    const error = err instanceof ChatRequestError ? err.message : 'Body must be valid JSON';
    finish('request.error', 400, error);
    return Response.json({ error }, { status: 400, headers });
  }

  let provider: ChatProvider;
  try {
    provider = getProvider(process.env);
  } catch (err) {
    console.error('[chat] provider config error:', err);
    finish('request.error', 500, err);
    return Response.json({ error: errorMessage(err) }, { status: 500, headers });
  }

  // chatTurn yields nothing until the provider replied, so upstream failures (bad key, unknown
  // model, rate limit, summary failure) become an HTTP error rather than a broken 200 stream.
  const events = chatTurn(turn, {
    store: sessions,
    provider,
    knowledge,
    signal: request.signal,
    onTrace,
  });
  let first: IteratorResult<ChatEvent>;
  try {
    first = await events.next();
  } catch (err) {
    if (err instanceof SessionBusyError) {
      finish('request.error', 409, err);
      return Response.json({ error: err.message }, { status: 409, headers });
    }
    console.error(`[chat] ${provider.name} failed:`, err);
    finish('request.error', 502, err);
    return Response.json(
      { error: `${provider.name}: ${errorMessage(err)}` },
      { status: 502, headers },
    );
  }

  return new Response(toNdjsonStream(first, events, finish), {
    headers: {
      ...headers,
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** Pull-based so the provider only generates as fast as the client reads. */
function toNdjsonStream(
  first: IteratorResult<ChatEvent>,
  rest: AsyncIterator<ChatEvent>,
  finish: (type: string, status?: number, error?: unknown) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let next: IteratorResult<ChatEvent> | undefined = first;
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = next ?? (await rest.next());
        next = undefined;
        if (result.done) {
          finish('request.end', 200);
          controller.close();
        } else controller.enqueue(encoder.encode(encodeChatEvent(result.value)));
      } catch (err) {
        console.error('[chat] stream failed:', err);
        finish('request.error', 200, err);
        controller.error(err);
      }
    },
    async cancel() {
      finish('request.abort');
      await rest.return?.();
    },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
