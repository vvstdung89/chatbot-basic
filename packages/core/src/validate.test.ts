import { describe, expect, it } from 'vitest';
import { ChatRequestError, parseMessages, parsePendingPayment, parseUserInfo } from './validate';

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
