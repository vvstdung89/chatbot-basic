import { describe, expect, it } from 'vitest';
import {
  ChatRequestError,
  MAX_HISTORY_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  parseChatRequest,
  parseMessages,
  parsePendingPayment,
  parseUserInfo,
  trimHistory,
} from './validate';

describe('parseMessages', () => {
  it('returns well-formed messages, dropping unknown fields', () => {
    expect(parseMessages({ messages: [{ role: 'user', content: 'hi', extra: 1 }] })).toEqual([
      { role: 'user', content: 'hi' },
    ]);
  });

  it.each([
    ['null body', null],
    ['missing messages', {}],
    ['empty messages', { messages: [] }],
    ['non-object message', { messages: ['hi'] }],
    ['unknown role', { messages: [{ role: 'tool', content: 'hi' }] }],
    ['non-string content', { messages: [{ role: 'user', content: 42 }] }],
  ])('rejects %s', (_, body) => {
    expect(() => parseMessages(body)).toThrow(ChatRequestError);
  });
});

describe('parseUserInfo', () => {
  it('returns known sections, dropping unknown keys', () => {
    expect(
      parseUserInfo({ userInfo: { profile: 'Name: An', commission: '5%', extra: 'x' } }),
    ).toEqual({ profile: 'Name: An', commission: '5%' });
  });

  it('returns no sections when userInfo is absent', () => {
    expect(parseUserInfo({})).toEqual({});
  });

  it.each([
    ['non-object userInfo', { userInfo: 'Name: An' }],
    ['non-string section', { userInfo: { profile: 42 } }],
    ['too long section', { userInfo: { payment: 'x'.repeat(10_001) } }],
  ])('rejects %s', (_, body) => {
    expect(() => parseUserInfo(body)).toThrow(ChatRequestError);
  });
});

describe('parsePendingPayment', () => {
  const info = { bin: '970436', accountNumber: '0123456789', type: 'account' };

  it('returns the pending payment details, or undefined when absent', () => {
    expect(
      parsePendingPayment({ pendingPayment: { ...info, bankShortName: 'Vietcombank', x: 1 } }),
    ).toEqual({ ...info, bankShortName: 'Vietcombank' });
    expect(parsePendingPayment({})).toBeUndefined();
  });

  it.each([
    ['non-object', 'x'],
    ['bad BIN', { ...info, bin: '97043' }],
    ['bad account number', { ...info, accountNumber: '12 34' }],
    ['bad type', { ...info, type: 'wallet' }],
    ['too long name', { ...info, accountName: 'A'.repeat(201) }],
  ])('rejects %s', (_, pendingPayment) => {
    expect(() => parsePendingPayment({ pendingPayment })).toThrow(ChatRequestError);
  });
});

describe('parseChatRequest', () => {
  it('reads messages, User Info and pending QR details from one body', () => {
    const pendingPayment = { bin: '970436', accountNumber: '0123456789', type: 'account' };
    expect(
      parseChatRequest({
        messages: [{ role: 'user', content: 'hi' }],
        userInfo: { profile: 'An' },
        pendingPayment,
      }),
    ).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      userInfo: { profile: 'An' },
      pendingPayment,
    });
  });

  it('leaves out absent optional parts', () => {
    expect(parseChatRequest({ messages: [{ role: 'user', content: 'hi' }] })).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      userInfo: {},
    });
  });
});

describe('request limits', () => {
  const msg = (content: string) => ({ role: 'user', content });

  it('accepts a request at the limits', () => {
    const messages = [msg('x'.repeat(MAX_MESSAGE_LENGTH)), msg('y')];
    expect(parseMessages({ messages })).toHaveLength(2);
  });

  it.each([
    ['too many messages', Array.from({ length: MAX_MESSAGES + 1 }, () => msg('hi'))],
    ['a message that is too long', [msg('x'.repeat(MAX_MESSAGE_LENGTH + 1))]],
    [
      'too much history in total',
      Array.from({ length: Math.ceil(MAX_HISTORY_LENGTH / MAX_MESSAGE_LENGTH) + 1 }, () =>
        msg('x'.repeat(MAX_MESSAGE_LENGTH)),
      ),
    ],
  ])('rejects %s', (_, messages) => {
    expect(() => parseMessages({ messages })).toThrow(ChatRequestError);
  });
});

describe('trimHistory', () => {
  const msg = (content: string) => ({ role: 'user' as const, content });

  it('keeps a history that is within the limits', () => {
    const messages = [msg('a'), msg('b')];
    expect(trimHistory(messages)).toEqual({ messages, dropped: 0 });
  });

  it('drops the oldest messages to fit the total length', () => {
    const big = msg('x'.repeat(MAX_MESSAGE_LENGTH));
    const messages = [msg('old'), big, big, big, msg('new')];
    const { messages: kept, dropped } = trimHistory(messages);
    expect(dropped).toBe(messages.length - kept.length);
    expect(kept.at(-1)).toEqual(msg('new'));
    expect(kept.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(MAX_HISTORY_LENGTH);
    expect(() => parseMessages({ messages: kept })).not.toThrow();
  });

  it('drops the oldest messages to fit the message count', () => {
    const messages = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => msg(String(i)));
    const { messages: kept, dropped } = trimHistory(messages);
    expect(dropped).toBe(5);
    expect(kept[0]).toEqual(msg('5'));
  });

  it('stops before a message that is too long to send', () => {
    const messages = [msg('a'), msg('x'.repeat(MAX_MESSAGE_LENGTH + 1)), msg('b'), msg('c')];
    expect(trimHistory(messages)).toEqual({ messages: [msg('b'), msg('c')], dropped: 2 });
  });
});
