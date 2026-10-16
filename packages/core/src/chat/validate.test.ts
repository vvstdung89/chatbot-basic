import { describe, expect, it } from 'vitest';
import {
  ChatRequestError,
  MAX_HISTORY_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  parseChatTurn,
  parseSessionId,
  parseUserInfo,
  trimHistory,
} from './validate';

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

describe('parseChatTurn', () => {
  const sessionId = '0b6c7c43-5f8e-4c6b-9f5e-2f1a5d3c7e11';

  it('reads the message (trimmed) and the optional session id', () => {
    expect(parseChatTurn({ sessionId, message: '  xin chào  ', extra: 1 })).toEqual({
      sessionId,
      message: 'xin chào',
    });
    expect(parseChatTurn({ message: 'hi' })).toEqual({ message: 'hi' });
  });

  it('accepts a message at the length limit', () => {
    expect(parseChatTurn({ message: 'x'.repeat(MAX_MESSAGE_LENGTH) }).message).toHaveLength(
      MAX_MESSAGE_LENGTH,
    );
  });

  it.each([
    ['a non-object body', 'hi'],
    ['a missing message', {}],
    ['a blank message', { message: '   ' }],
    ['a non-string message', { message: 42 }],
    ['a message that is too long', { message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }],
    ['a malformed session id', { message: 'hi', sessionId: '../etc' }],
  ])('rejects %s', (_, body) => {
    expect(() => parseChatTurn(body)).toThrow(ChatRequestError);
  });
});

describe('parseSessionId', () => {
  it('accepts session ids and rejects anything else', () => {
    expect(parseSessionId('0b6c7c43-5f8e-4c6b-9f5e-2f1a5d3c7e11')).toBe(
      '0b6c7c43-5f8e-4c6b-9f5e-2f1a5d3c7e11',
    );
    for (const bad of [undefined, '', 42, 'a b', 'x'.repeat(65)]) {
      expect(() => parseSessionId(bad)).toThrow(ChatRequestError);
    }
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
