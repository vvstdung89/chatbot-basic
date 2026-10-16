import { ChatRequestError, parseSessionId, parseUserInfo, type UserInfo } from '@chatbot/core';
import { sessions } from '@/lib/sessions';

/**
 * PUT /api/session/user-info  { sessionId, userInfo }  → 204
 * Partial: only the User Info parts sent are replaced, so a Settings edit never overwrites a User
 * Payment saved by the bank tool. Errors: 400 bad body, 404 unknown or expired session.
 */
export async function PUT(request: Request): Promise<Response> {
  let id: string;
  let userInfo: UserInfo;
  try {
    const body: unknown = await request.json();
    id = parseSessionId((body as { sessionId?: unknown } | null)?.sessionId);
    userInfo = parseUserInfo(body);
  } catch (err) {
    const error = err instanceof ChatRequestError ? err.message : 'Body must be valid JSON';
    return Response.json({ error }, { status: 400 });
  }

  const session = await sessions.get(id);
  if (!session) return Response.json({ error: 'Unknown or expired session' }, { status: 404 });
  session.userInfo = { ...session.userInfo, ...userInfo };
  await sessions.save(session);
  return new Response(null, { status: 204 });
}
