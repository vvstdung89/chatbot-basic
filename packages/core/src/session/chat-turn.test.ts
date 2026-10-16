import { describe, expect, it } from 'vitest';
import { SUMMARY_PROMPT } from '../chat/prompt';
import type { PaymentQrInfo } from '../payment/vietqr';
import type { ChatEvent, ChatMessage, ChatProvider, ChatTool } from '../types';
import { chatTurn, SessionBusyError } from './chat-turn';
import { MemorySessionStore } from './store';

type Reply = (messages: ChatMessage[], tools: ChatTool[]) => AsyncIterable<string>;

/** Records chat calls (not summary calls); summary calls answer "SUMMARY". */
function fakeProvider(reply: Reply) {
  const calls: ChatMessage[][] = [];
  const provider: ChatProvider = {
    name: 'fake',
    async *streamChat(messages, options) {
      if (messages[0]?.content === SUMMARY_PROMPT) {
        yield 'SUMMARY';
        return;
      }
      calls.push(messages);
      yield* reply(messages, options?.tools ?? []);
    },
  };
  return { provider, calls };
}

async function* chunks(...texts: string[]) {
  yield* texts;
}

const bankTool = (tools: ChatTool[]) => tools.find((t) => t.name === 'update_bank_info')!;

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const vietcombank: PaymentQrInfo = {
  bin: '970436',
  bankCode: 'VCB',
  bankShortName: 'Vietcombank',
  bankName: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
  accountNumber: '0123456789',
  type: 'account',
};
const VCB_PAYMENT =
  'Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)\nSố tài khoản: 0123456789';

describe('chatTurn', () => {
  it('starts a session: session event first, then the reply; both messages are stored', async () => {
    const store = new MemorySessionStore();
    const { provider } = fakeProvider(() => chunks('Xin ', 'chào'));

    const events = await collect(chatTurn({ message: 'hi' }, { store, provider }));

    expect(events[0]?.type).toBe('session');
    const sessionId = (events[0] as { sessionId: string }).sessionId;
    expect(events.slice(1)).toEqual([
      { type: 'text', text: 'Xin ' },
      { type: 'text', text: 'chào' },
    ]);
    expect((await store.get(sessionId))?.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Xin chào' },
    ]);
  });

  it('continues a stored conversation with its User Info', async () => {
    const store = new MemorySessionStore();
    const session = await store.create();
    session.userInfo = { profile: 'Name: An' };
    await store.save(session);
    const { provider, calls } = fakeProvider(() => chunks('ok'));

    await collect(chatTurn({ sessionId: session.id, message: 'one' }, { store, provider }));
    const events = await collect(
      chatTurn({ sessionId: session.id, message: 'two' }, { store, provider }),
    );

    expect(events[0]).toEqual({ type: 'session', sessionId: session.id });
    expect(calls[1]?.[0]?.content).toContain('### User Profile ###\nName: An');
    expect(calls[1]?.slice(1)).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'two' },
    ]);
  });

  it('starts a new session when the id is unknown or expired', async () => {
    const store = new MemorySessionStore();
    const { provider } = fakeProvider(() => chunks('ok'));
    const [first] = await collect(
      chatTurn({ sessionId: 'gone', message: 'hi' }, { store, provider }),
    );
    expect(first).toMatchObject({ type: 'session' });
    expect((first as { sessionId: string }).sessionId).not.toBe('gone');
  });

  it('refuses a second request while the session is busy, and frees it afterwards', async () => {
    const store = new MemorySessionStore();
    const { id } = await store.create();
    const { provider } = fakeProvider(() => chunks('ok'));
    await store.tryLock(id);

    await expect(
      chatTurn({ sessionId: id, message: 'hi' }, { store, provider }).next(),
    ).rejects.toThrow(SessionBusyError);

    await store.unlock(id);
    await collect(chatTurn({ sessionId: id, message: 'hi' }, { store, provider }));
    expect(await store.tryLock(id)).toBe(true);
  });

  it('fails before the reply: rejects the first next(), keeps the user message, frees the session', async () => {
    const store = new MemorySessionStore();
    const { id } = await store.create();
    const provider: ChatProvider = {
      name: 'fake',
      async *streamChat() {
        throw new Error('401 invalid key');
      },
    };

    const before = (await store.get(id))!;
    before.summary = { count: 0, content: 'earlier summary' };
    await store.save(before);

    await expect(
      chatTurn({ sessionId: id, message: 'hi' }, { store, provider }).next(),
    ).rejects.toThrow('401 invalid key');
    const after = await store.get(id);
    expect(after?.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(after?.summary).toEqual({ count: 0, content: 'earlier summary' }); // unchanged
    expect(await store.tryLock(id)).toBe(true);
  });

  it('stores the partial reply when the stream fails after it started', async () => {
    const store = new MemorySessionStore();
    const { id } = await store.create();
    const { provider } = fakeProvider(async function* () {
      yield 'partial';
      throw new Error('disconnected');
    });

    await expect(
      collect(chatTurn({ sessionId: id, message: 'hi' }, { store, provider })),
    ).rejects.toThrow('disconnected');
    expect((await store.get(id))?.messages.at(-1)).toEqual({
      role: 'assistant',
      content: 'partial',
    });
  });

  it('stores the summary for the divider', async () => {
    const store = new MemorySessionStore();
    const session = await store.create();
    const long = 'x'.repeat(6000);
    session.messages = [
      { role: 'user', content: long },
      { role: 'assistant', content: long },
      { role: 'user', content: long },
      { role: 'assistant', content: long },
    ];
    await store.save(session);
    const { provider } = fakeProvider(() => chunks('ok'));

    const events = await collect(
      chatTurn({ sessionId: session.id, message: 'q' }, { store, provider }),
    );

    expect(events[1]).toMatchObject({ type: 'summary', content: 'SUMMARY' });
    expect((await store.get(session.id))?.summary).toEqual({
      count: (events[1] as { count: number }).count,
      content: 'SUMMARY',
    });
  });

  describe('bank info is saved only after the user confirms (option B)', () => {
    it('turn 1 proposes (pending, not saved); turn 2 confirms (saved, pending cleared)', async () => {
      const store = new MemorySessionStore();
      const { id } = await store.create();
      const { provider, calls } = fakeProvider(async function* (messages, tools) {
        const last = messages.at(-1)?.content;
        if (last === 'đổi sang VCB 0123456789') {
          await bankTool(tools).run({ step: 'propose', bank: 'VCB', accountNumber: '0123456789' });
          yield 'Dạ em đọc lại ạ.';
        } else {
          await bankTool(tools).run({ step: 'confirm' });
          yield 'Dạ đã lưu ạ.';
        }
      });

      const turn1 = await collect(
        chatTurn({ sessionId: id, message: 'đổi sang VCB 0123456789' }, { store, provider }),
      );
      expect(turn1.map((e) => e.type)).toEqual(['session', 'text']); // pending_payment stays here
      expect(await store.get(id)).toMatchObject({ pendingPayment: vietcombank, userInfo: {} });

      const turn2 = await collect(
        chatTurn({ sessionId: id, message: 'đúng rồi' }, { store, provider }),
      );
      expect(calls[1]?.[0]?.content).toContain('## Pending Bank Details ##');
      expect(turn2).toContainEqual({ type: 'payment', payment: VCB_PAYMENT });
      const saved = await store.get(id);
      expect(saved?.userInfo.payment).toBe(VCB_PAYMENT);
      expect(saved?.pendingPayment).toBeUndefined();
    });

    it('cancel discards the pending details', async () => {
      const store = new MemorySessionStore();
      const session = await store.create();
      session.pendingPayment = vietcombank;
      await store.save(session);
      const { provider } = fakeProvider(async function* (_, tools) {
        await bankTool(tools).run({ step: 'cancel' });
        yield 'Dạ vâng.';
      });

      await collect(chatTurn({ sessionId: session.id, message: 'thôi' }, { store, provider }));

      const saved = await store.get(session.id);
      expect(saved?.pendingPayment).toBeUndefined();
      expect(saved?.userInfo.payment).toBeUndefined();
    });

    it('cannot propose and confirm in the same turn', async () => {
      const store = new MemorySessionStore();
      const { provider } = fakeProvider(async function* (_, tools) {
        await bankTool(tools).run({ step: 'propose', bank: 'VCB', accountNumber: '0123456789' });
        await bankTool(tools).run({ step: 'confirm' });
        yield 'ok';
      });

      const [first] = await collect(
        chatTurn({ message: 'đổi sang VCB 0123456789' }, { store, provider }),
      );

      const saved = await store.get((first as { sessionId: string }).sessionId);
      expect(saved?.userInfo.payment).toBeUndefined();
      expect(saved?.pendingPayment).toEqual(vietcombank);
    });

    it('keeps a User Info edit made while the reply streams', async () => {
      const store = new MemorySessionStore();
      const session = await store.create();
      session.pendingPayment = vietcombank;
      await store.save(session);
      const { provider } = fakeProvider(async function* (_, tools) {
        yield 'Dạ ';
        // Meanwhile the Settings panel saves User Profile (PUT /api/session/user-info).
        const latest = (await store.get(session.id))!;
        latest.userInfo = { ...latest.userInfo, profile: 'Name: An' };
        await store.save(latest);
        await bankTool(tools).run({ step: 'confirm' });
        yield 'đã lưu ạ.';
      });

      await collect(chatTurn({ sessionId: session.id, message: 'đúng rồi' }, { store, provider }));

      expect((await store.get(session.id))?.userInfo).toEqual({
        profile: 'Name: An',
        payment: VCB_PAYMENT,
      });
    });
  });
});
