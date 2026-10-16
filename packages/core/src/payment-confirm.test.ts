import { describe, expect, it } from 'vitest';
import { classifyPaymentReply, resolvePendingPayment } from './payment-confirm';
import { PAYMENT_CONFIRM_PROMPT } from './prompt';
import type { ChatMessage, ChatOptions, ChatProvider } from './types';
import type { PaymentQrInfo } from './vietqr';

const pending: PaymentQrInfo = {
  bin: '970436',
  bankCode: 'VCB',
  bankShortName: 'Vietcombank',
  bankName: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
  accountNumber: '0123456789',
  type: 'account',
};

function fakeProvider(...chunks: string[]) {
  const seen: { messages?: ChatMessage[]; options?: ChatOptions } = {};
  const provider: ChatProvider = {
    name: 'fake',
    async *streamChat(messages, options) {
      Object.assign(seen, { messages, options });
      yield* chunks;
    },
  };
  return { provider, seen };
}

describe('classifyPaymentReply', () => {
  it('sends the pending details and the reply, and reads the JSON answer', async () => {
    const { provider, seen } = fakeProvider('{"decision": "confirm", ', '"accountName": null}');
    const signal = new AbortController().signal;

    expect(await classifyPaymentReply(provider, pending, 'đúng rồi', signal)).toEqual({
      decision: 'confirm',
    });
    expect(seen.messages).toEqual([
      { role: 'system', content: PAYMENT_CONFIRM_PROMPT },
      {
        role: 'user',
        content:
          'Pending details:\nNgân hàng: Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)\n' +
          'Số tài khoản: 0123456789\n\nUser reply:\nđúng rồi',
      },
    ]);
    expect(seen.options).toEqual({ signal });
  });

  it('accepts JSON wrapped in a code fence and keeps a stated name', async () => {
    const { provider } = fakeProvider(
      '```json\n{"decision":"confirm","accountName":"Nguyễn Văn A"}\n```',
    );
    expect(await classifyPaymentReply(provider, pending, 'ok, tên Nguyễn Văn A')).toEqual({
      decision: 'confirm',
      accountName: 'Nguyễn Văn A',
    });
  });

  it.each([['not json'], ['{"decision":"maybe"}'], ['']])(
    'treats an unusable answer (%j) as unclear',
    async (answer) => {
      const { provider } = fakeProvider(answer);
      expect(await classifyPaymentReply(provider, pending, 'hmm')).toEqual({
        decision: 'unclear',
      });
    },
  );
});

describe('resolvePendingPayment', () => {
  it('builds the new User Payment from the QR details and the name the user gave', async () => {
    const { provider } = fakeProvider('{"decision":"confirm","accountName":"nguyễn văn a"}');
    expect(await resolvePendingPayment(provider, pending, 'đúng, tên nguyễn văn a')).toEqual({
      status: 'confirmed',
      payment:
        'Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)\n' +
        'Số tài khoản: 0123456789\nChủ tài khoản: NGUYEN VAN A',
    });
  });

  it('reports a declined update', async () => {
    const { provider } = fakeProvider('{"decision":"decline","accountName":null}');
    expect(await resolvePendingPayment(provider, pending, 'hủy')).toEqual({ status: 'declined' });
  });

  it('keeps waiting when the reply is unclear', async () => {
    const { provider } = fakeProvider('{"decision":"unclear","accountName":null}');
    expect(await resolvePendingPayment(provider, pending, 'phí rút là bao nhiêu?')).toEqual({
      status: 'pending',
      payment:
        'Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)\nSố tài khoản: 0123456789',
    });
  });
});
