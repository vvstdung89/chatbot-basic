import { readFileSync } from 'node:fs';
import { readChatEvents, type ChatEvent } from '@chatbot/core/client';
import { describe, expect, it } from 'vitest';
import { E2E_PORT } from './server';

const BASE = `http://localhost:${E2E_PORT}`;

function postChat(body: unknown) {
  return fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postImage(bytes: Uint8Array<ArrayBuffer>, type: string) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type }), 'upload');
  return fetch(`${BASE}/api/payment-qr`, { method: 'POST', body: form });
}

describe('e2e: production server with the echo provider', () => {
  it('serves the chat page', async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Chatbot');
  });

  it('streams the reply as NDJSON text events', async () => {
    const res = await postChat({
      messages: [{ role: 'user', content: 'xin chào' }],
      userInfo: { profile: 'Name: An' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events: ChatEvent[] = [];
    for await (const event of readChatEvents(res.body!)) events.push(event);
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => (e.type === 'text' ? e.text : '')).join('')).toBe(
      'You said: xin chào',
    );
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['no messages', { messages: [] }],
    [
      'too many messages',
      { messages: Array.from({ length: 1001 }, () => ({ role: 'user', content: 'hi' })) },
    ],
    [
      'bad pending payment',
      { messages: [{ role: 'user', content: 'hi' }], pendingPayment: { bin: 'x' } },
    ],
  ])('answers 400 for %s', async (_, body) => {
    const res =
      typeof body === 'string'
        ? await fetch(`${BASE}/api/chat`, { method: 'POST', body })
        : await postChat(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('reads a bank QR image', async () => {
    const png = new Uint8Array(
      readFileSync(new URL('./fixtures/vietqr-vietcombank.png', import.meta.url)),
    );
    const res = await postImage(png, 'image/png');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bin: '970436',
      bankCode: 'VCB',
      bankShortName: 'Vietcombank',
      bankName: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
      accountNumber: '0123456789',
      type: 'account',
    });
  });

  it('rejects uploads that are not a readable bank QR', async () => {
    const text = new TextEncoder().encode('hello');
    expect((await postImage(text, 'text/plain')).status).toBe(400);
    expect((await postImage(text, 'image/png')).status).toBe(422);
  });
});
