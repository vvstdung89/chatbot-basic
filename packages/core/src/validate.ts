import type { ChatMessage, ChatRole } from './types';
import { MAX_USER_INFO_LENGTH, USER_INFO_SECTIONS, type UserInfo } from './user-info';

const ROLES: ReadonlySet<string> = new Set<ChatRole>(['system', 'user', 'assistant']);

/** Thrown when a chat request body is malformed; safe to show to the client. */
export class ChatRequestError extends Error {
  override name = 'ChatRequestError';
}

/** Validates an untrusted `{ messages: [...] }` body and returns its messages. */
export function parseMessages(body: unknown): ChatMessage[] {
  const messages = isRecord(body) ? body.messages : undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ChatRequestError('Body must be an object with a non-empty "messages" array');
  }

  return messages.map((message: unknown, i): ChatMessage => {
    if (!isRecord(message)) {
      throw new ChatRequestError(`messages[${i}] must be an object`);
    }
    const { role, content } = message;
    if (typeof role !== 'string' || !ROLES.has(role)) {
      throw new ChatRequestError(`messages[${i}].role must be one of: ${[...ROLES].join(', ')}`);
    }
    if (typeof content !== 'string') {
      throw new ChatRequestError(`messages[${i}].content must be a string`);
    }
    return { role: role as ChatRole, content };
  });
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
