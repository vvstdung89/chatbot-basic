import { ChatRequestError, parseSessionId } from '@chatbot/core';
import { sessions, sessionView } from '@/lib/sessions';

/** POST /api/session → 201 { sessionId, messages: [], userInfo: {} }: a new empty session. */
export async function POST(): Promise<Response> {
  return Response.json(sessionView(await sessions.create()), { status: 201 });
}

/**
 * GET /api/session?id=… → { sessionId, messages, userInfo, summary? } to restore the chat.
 * Errors: 400 malformed id, 404 unknown or expired session.
 */
export async function GET(request: Request): Promise<Response> {
  let id: string;
  try {
    id = parseSessionId(new URL(request.url).searchParams.get('id') ?? undefined);
  } catch (err) {
    if (!(err instanceof ChatRequestError)) throw err;
    return Response.json({ error: err.message }, { status: 400 });
  }
  const session = await sessions.get(id);
  if (!session) return Response.json({ error: 'Unknown or expired session' }, { status: 404 });
  return Response.json(sessionView(session));
}
