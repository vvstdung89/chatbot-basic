import { describe, expect, it } from 'vitest';
import { ChatRequestError, parseMessages, parseUserInfo } from './validate';

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
