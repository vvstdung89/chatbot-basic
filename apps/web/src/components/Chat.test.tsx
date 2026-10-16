import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from './Chat';

const STORAGE_KEY = 'chatbot.userInfo';

/** A /api/chat NDJSON body the test writes events into. */
function eventStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    push: (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)),
    close: () => controller.close(),
  };
}

function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn(); // not implemented by jsdom
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** fetch stub: /api/chat answers with the next list of events, /api/payment-qr with `qr`. */
function stubApi(replies: object[][], qr?: object) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/payment-qr') return Response.json(qr);
      bodies.push(JSON.parse(String(init?.body)));
      const stream = eventStream();
      for (const event of replies.shift() ?? []) stream.push(event);
      stream.close();
      return stream.response;
    }),
  );
  return bodies;
}

const vietcombank = {
  bin: '970436',
  bankCode: 'VCB',
  bankShortName: 'Vietcombank',
  bankName: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
  accountNumber: '0123456789',
  type: 'account',
};

describe('Chat', () => {
  it('sends the history and User Info, and streams the reply', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: 'Name: An' }));
    const bodies = stubApi([
      [
        { type: 'text', text: 'Xin ' },
        { type: 'text', text: 'chào' },
      ],
    ]);
    render(<Chat />);

    sendMessage('hi');

    await screen.findByText('Xin chào');
    expect(bodies).toEqual([
      { messages: [{ role: 'user', content: 'hi' }], userInfo: { profile: 'Name: An' } },
    ]);
  });

  it('sends only the newest messages within the limits; the summary divider counts the rest', async () => {
    const long = (n: number) => `${n}`.padEnd(50_000, '.');
    const bodies = stubApi([
      [{ type: 'text', text: 'r1' }],
      [{ type: 'text', text: 'r2' }],
      [{ type: 'text', text: 'r3' }],
      [
        { type: 'summary', count: 2, content: 'Earlier: four long messages' },
        { type: 'text', text: 'r4' },
      ],
    ]);
    render(<Chat />);

    for (const [n, reply] of [
      [1, 'r1'],
      [2, 'r2'],
      [3, 'r3'],
      [4, 'r4'],
    ] as const) {
      sendMessage(long(n));
      await screen.findByText(reply);
    }

    // 4 × 50,000 characters is over the 150,000 limit: the oldest 3 messages are not sent.
    expect(bodies[3]?.messages).toEqual([
      { role: 'assistant', content: 'r2' },
      { role: 'user', content: long(3) },
      { role: 'assistant', content: 'r3' },
      { role: 'user', content: long(4) },
    ]);
    // The summary replaces 2 sent messages, i.e. the first 3 + 2 of the whole chat.
    const divider = screen.getByText('Earlier conversation summarized').closest('details');
    expect(divider?.nextElementSibling?.textContent).toBe('r3');
  });

  it('reads a bank QR back, sends it as pending until a payment event saves it', async () => {
    const bodies = stubApi(
      [
        [
          { type: 'payment', payment: 'Ngân hàng: Vietcombank\nSố tài khoản: 0123456789' },
          { type: 'text', text: 'Dạ em đã lưu ạ.' },
        ],
        [{ type: 'text', text: 'Không có gì ạ.' }],
      ],
      vietcombank,
    );
    const { container } = render(<Chat />);

    const fileInput = container.querySelector('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(['png'], 'qr.png')] } });
    await screen.findByText(/Dạ em đọc được từ mã QR/);
    expect(screen.getByText('[Ảnh mã QR ngân hàng]')).toBeTruthy();

    sendMessage('đúng rồi');
    await screen.findByText('Dạ em đã lưu ạ.');
    sendMessage('cảm ơn');
    await screen.findByText('Không có gì ạ.');

    expect(bodies[0]?.pendingPayment).toEqual(vietcombank);
    expect(bodies[1]).not.toHaveProperty('pendingPayment');
    expect(screen.getByLabelText('User Payment')).toHaveProperty(
      'value',
      'Ngân hàng: Vietcombank\nSố tài khoản: 0123456789',
    );
  });

  it('keeps User Info edits made while a reply streams when a payment event arrives', async () => {
    const stream = eventStream();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream.response),
    );
    render(<Chat />);

    sendMessage('đổi STK sang Techcombank 19031234567');
    await act(async () => stream.push({ type: 'text', text: 'Dạ em ' }));
    await screen.findByText('Dạ em');

    // The user edits Settings while the reply is still streaming.
    fireEvent.change(screen.getByLabelText('User Profile'), { target: { value: 'Name: An' } });

    await act(async () => {
      stream.push({
        type: 'payment',
        payment: 'Ngân hàng: Techcombank\nSố tài khoản: 19031234567',
      });
      stream.push({ type: 'text', text: 'đã lưu ạ.' });
      stream.close();
    });
    await screen.findByText('Dạ em đã lưu ạ.');

    expect(screen.getByLabelText('User Profile')).toHaveProperty('value', 'Name: An');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      profile: 'Name: An',
      payment: 'Ngân hàng: Techcombank\nSố tài khoản: 19031234567',
    });
  });
});
