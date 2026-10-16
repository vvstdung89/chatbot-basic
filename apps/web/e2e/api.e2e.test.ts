import { readFileSync } from 'node:fs';
import { readChatEvents, type ChatEvent, type ChatMessage } from '@chatbot/core/client';
import { describe, expect, it } from 'vitest';
import { E2E_PORT } from './server';

const BASE = `http://localhost:${E2E_PORT}`;

interface SessionView {
  sessionId: string;
  messages: ChatMessage[];
  userInfo: Record<string, string>;
}

function postChat(body: unknown) {
  return fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function chat(body: unknown): Promise<ChatEvent[]> {
  const res = await postChat(body);
  expect(res.status).toBe(200);
  const events: ChatEvent[] = [];
  for await (const event of readChatEvents(res.body!)) events.push(event);
  return events;
}

const replyText = (events: ChatEvent[]) =>
  events.map((e) => (e.type === 'text' ? e.text : '')).join('');

async function newSession(): Promise<SessionView> {
  const res = await fetch(`${BASE}/api/session`, { method: 'POST' });
  expect(res.status).toBe(201);
  return (await res.json()) as SessionView;
}

const getSession = (id: string) => fetch(`${BASE}/api/session?id=${id}`);

function postImage(sessionId: string, bytes: Uint8Array<ArrayBuffer>, type: string) {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('image', new Blob([bytes], { type }), 'upload');
  return fetch(`${BASE}/api/payment-qr`, { method: 'POST', body: form });
}

describe('e2e: production server with the echo provider', () => {
  it('serves the chat page', async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Chatbot');
  });

  it('starts a session on the first message and streams the reply as NDJSON', async () => {
    const res = await postChat({ message: 'xin chào' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(res.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
    const events: ChatEvent[] = [];
    for await (const event of readChatEvents(res.body!)) events.push(event);
    expect(events[0]).toMatchObject({ type: 'session' });
    expect(replyText(events)).toBe('You said: xin chào');
  });

  it('keeps the conversation on the server: follow-ups, restore and User Info', async () => {
    const { sessionId } = await newSession();

    await chat({ sessionId, message: 'một' });
    const second = await chat({ sessionId, message: 'hai' });
    expect(second[0]).toEqual({ type: 'session', sessionId });

    const put = await fetch(`${BASE}/api/session/user-info`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userInfo: { profile: 'Name: An' } }),
    });
    expect(put.status).toBe(204);

    expect(await (await getSession(sessionId)).json()).toEqual({
      sessionId,
      messages: [
        { role: 'user', content: 'một' },
        { role: 'assistant', content: 'You said: một' },
        { role: 'user', content: 'hai' },
        { role: 'assistant', content: 'You said: hai' },
      ],
      userInfo: { profile: 'Name: An' },
    });
  });

  it('answers 404 for an unknown session', async () => {
    expect((await getSession('0b6c7c43-5f8e-4c6b-9f5e-2f1a5d3c7e11')).status).toBe(404);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['no message', {}],
    ['a blank message', { message: '   ' }],
    ['a message over 50,000 characters', { message: 'x'.repeat(50_001) }],
    ['a malformed session id', { sessionId: '../x', message: 'hi' }],
  ])('answers 400 for %s', async (_, body) => {
    const res =
      typeof body === 'string'
        ? await fetch(`${BASE}/api/chat`, { method: 'POST', body })
        : await postChat(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('reads a bank QR image into the session and the chat', async () => {
    const { sessionId } = await newSession();
    const png = new Uint8Array(
      readFileSync(new URL('./fixtures/vietqr-vietcombank.png', import.meta.url)),
    );

    const res = await postImage(sessionId, png, 'image/png');

    expect(res.status).toBe(200);
    const { messages } = (await res.json()) as { messages: ChatMessage[] };
    expect(messages[0]).toEqual({ role: 'user', content: '[Ảnh mã QR ngân hàng]' });
    expect(messages[1]?.content).toContain('Vietcombank');
    expect(messages[1]?.content).toContain('0123456789');
    expect(((await (await getSession(sessionId)).json()) as SessionView).messages).toEqual(
      messages,
    );
  });

  it('rejects uploads that are not a readable bank QR, explaining it in the chat', async () => {
    const { sessionId } = await newSession();
    const text = new TextEncoder().encode('hello');

    expect((await postImage(sessionId, text, 'text/plain')).status).toBe(400);
    const unreadable = await postImage(sessionId, text, 'image/png');
    expect(unreadable.status).toBe(422);
    expect(await unreadable.json()).toMatchObject({
      messages: [{ content: '[Ảnh mã QR ngân hàng]' }, {}],
    });
    expect(
      (await postImage('0b6c7c43-5f8e-4c6b-9f5e-2f1a5d3c7e11', text, 'image/png')).status,
    ).toBe(404);
  });
});
