import type { ChatMessage, ChatRole } from '../types';
import { MAX_USER_INFO_LENGTH, USER_INFO_SECTIONS, type UserInfo } from './user-info';
import type { PaymentQrInfo } from '../payment/vietqr';

const ROLES: ReadonlySet<string> = new Set<ChatRole>(['system', 'user', 'assistant']);

/** Thrown when a chat request body is malformed; safe to show to the client. */
export class ChatRequestError extends Error {
  override name = 'ChatRequestError';
}

/** Longest message accepted, in characters. */
export const MAX_MESSAGE_LENGTH = 50_000;
/**
 * Most history accepted per request. The server reads at most ~26k tokens (~80k characters) of
 * history anyway (kept messages + summarizer input), so trimHistory changes nothing the model sees.
 */
export const MAX_MESSAGES = 1_000;
export const MAX_HISTORY_LENGTH = 150_000;

/** Validates an untrusted `{ messages: [...] }` body and returns its messages. */
export function parseMessages(body: unknown): ChatMessage[] {
  const messages = isRecord(body) ? body.messages : undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ChatRequestError('Body must be an object with a non-empty "messages" array');
  }
  if (messages.length > MAX_MESSAGES) {
    throw new ChatRequestError(`messages must have at most ${MAX_MESSAGES} items`);
  }

  let length = 0;
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
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new ChatRequestError(
        `messages[${i}].content must be at most ${MAX_MESSAGE_LENGTH} characters`,
      );
    }
    length += content.length;
    if (length > MAX_HISTORY_LENGTH) {
      throw new ChatRequestError(`messages must total at most ${MAX_HISTORY_LENGTH} characters`);
    }
    return { role: role as ChatRole, content };
  });
}

/**
 * The newest messages that fit the request limits, for the browser to send; `dropped` is how many
 * older messages were left out. Stops before a message that is too long to send.
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

/** A validated POST /api/chat body. */
export interface ChatRequest {
  messages: ChatMessage[];
  userInfo: UserInfo;
  /** QR bank details waiting for the user's confirmation. */
  pendingPayment?: PaymentQrInfo;
}

/** Validates an untrusted POST /api/chat body; throws ChatRequestError when it is malformed. */
export function parseChatRequest(body: unknown): ChatRequest {
  const pendingPayment = parsePendingPayment(body);
  return {
    messages: parseMessages(body),
    userInfo: parseUserInfo(body),
    ...(pendingPayment && { pendingPayment }),
  };
}

const PAYMENT_TEXT_FIELDS = ['bankCode', 'bankShortName', 'bankName', 'accountName'] as const;

/** Returns the optional `pendingPayment` (QR details awaiting confirmation) from a body. */
export function parsePendingPayment(body: unknown): PaymentQrInfo | undefined {
  const value = isRecord(body) ? body.pendingPayment : undefined;
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new ChatRequestError('pendingPayment must be an object');
  }
  const { bin, accountNumber, type } = value;
  if (typeof bin !== 'string' || !/^\d{6}$/.test(bin)) {
    throw new ChatRequestError('pendingPayment.bin must be 6 digits');
  }
  if (typeof accountNumber !== 'string' || !/^[0-9A-Za-z]{1,32}$/.test(accountNumber)) {
    throw new ChatRequestError('pendingPayment.accountNumber must be 1-32 letters or digits');
  }
  if (type !== 'account' && type !== 'card') {
    throw new ChatRequestError('pendingPayment.type must be "account" or "card"');
  }

  const info: PaymentQrInfo = { bin, accountNumber, type };
  for (const key of PAYMENT_TEXT_FIELDS) {
    const text = value[key];
    if (text === undefined) continue;
    if (typeof text !== 'string' || text.length > 200) {
      throw new ChatRequestError(
        `pendingPayment.${key} must be a string of at most 200 characters`,
      );
    }
    info[key] = text;
  }
  return info;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
