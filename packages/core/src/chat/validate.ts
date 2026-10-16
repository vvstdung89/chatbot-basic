import type { ChatMessage } from '../types';
import { MAX_USER_INFO_LENGTH, USER_INFO_SECTIONS, type UserInfo } from './user-info';

/** Thrown when a request body is malformed; safe to show to the client. */
export class ChatRequestError extends Error {
  override name = 'ChatRequestError';
}

/** Longest message accepted, in characters. */
export const MAX_MESSAGE_LENGTH = 50_000;
/**
 * Most history kept per session. The server reads at most ~26k tokens (~80k characters) of history
 * anyway (kept messages + summarizer input), so trimming to this changes nothing the model sees.
 */
export const MAX_MESSAGES = 1_000;
export const MAX_HISTORY_LENGTH = 150_000;

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A validated POST /api/chat body: the new message, for an existing or a new session. */
export interface ChatTurnRequest {
  sessionId?: string;
  message: string;
}

/** Validates an untrusted `{ sessionId?, message }` body. */
export function parseChatTurn(body: unknown): ChatTurnRequest {
  if (!isRecord(body)) throw new ChatRequestError('Body must be an object');
  const { message, sessionId } = body;
  if (typeof message !== 'string' || !message.trim()) {
    throw new ChatRequestError('"message" must be a non-empty string');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new ChatRequestError(`"message" must be at most ${MAX_MESSAGE_LENGTH} characters`);
  }
  return {
    ...(sessionId !== undefined && { sessionId: parseSessionId(sessionId) }),
    message: message.trim(),
  };
}

/** Validates an untrusted session id (letters, digits, "-" and "_", at most 64). */
export function parseSessionId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID.test(value)) {
    throw new ChatRequestError('"sessionId" is not a valid session id');
  }
  return value;
}

/**
 * The newest messages within the history limits; `dropped` is how many older messages were left
 * out. Stops before a message that is too long to keep.
 */
export function trimHistory(messages: ChatMessage[]): {
  messages: ChatMessage[];
  dropped: number;
} {
  let start = messages.length;
  let length = 0;
  while (start > 0 && messages.length - start < MAX_MESSAGES) {
    const content = messages[start - 1]!.content;
    if (content.length > MAX_MESSAGE_LENGTH || length + content.length > MAX_HISTORY_LENGTH) break;
    length += content.length;
    start--;
  }
  return { messages: messages.slice(start), dropped: start };
}

/** Returns the optional `userInfo` sections from an untrusted body, dropping unknown keys. */
export function parseUserInfo(body: unknown): UserInfo {
  const userInfo = isRecord(body) ? body.userInfo : undefined;
  if (userInfo === undefined) return {};
  if (!isRecord(userInfo)) {
    throw new ChatRequestError('userInfo must be an object');
  }

  const result: UserInfo = {};
  for (const { key } of USER_INFO_SECTIONS) {
    const text = userInfo[key];
    if (text === undefined) continue;
    if (typeof text !== 'string') {
      throw new ChatRequestError(`userInfo.${key} must be a string`);
    }
    if (text.length > MAX_USER_INFO_LENGTH) {
      throw new ChatRequestError(
        `userInfo.${key} must be at most ${MAX_USER_INFO_LENGTH} characters`,
      );
    }
    result[key] = text;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
