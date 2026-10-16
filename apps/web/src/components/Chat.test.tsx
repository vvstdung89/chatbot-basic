import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from './Chat';

const SESSION_KEY = 'chatbot.sessionId';
const OLD_USER_INFO_KEY = 'chatbot.userInfo';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** fetch stub routing "METHOD /path" to handlers; records every call. */
function stubApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body =
        typeof init?.body === 'string'
          ? JSON.parse(init.body)
          : init?.body instanceof FormData
            ? Object.fromEntries(init.body)
            : undefined;
      calls.push({ method, url, body });
      const handler = routes[`${method} ${url.split('?')[0]}`];
      if (!handler) throw new Error(`unexpected ${method} ${url}`);
      return handler(url, init);
    }),
  );
  return calls;
}

const newSession = () =>
  Response.json({ sessionId: 's1', messages: [], userInfo: {} }, { status: 201 });

const ndjson = (events: object[]) =>
  new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(''), {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });

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

describe('Chat', () => {
  it('starts a session, then sends only the session id and the message', async () => {
    const calls = stubApi({
      'POST /api/session': newSession,
      'POST /api/chat': () =>
        ndjson([
          { type: 'session', sessionId: 's1' },
          { type: 'text', text: 'Xin ' },
          { type: 'text', text: 'chào' },
        ]),
    });
    render(<Chat />);
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBe('s1'));

    sendMessage('hi');

    await screen.findByText('Xin chào');
    expect(calls.find((c) => c.url === '/api/chat')?.body).toEqual({
      sessionId: 's1',
      message: 'hi',
    });
  });

  it('restores a saved session: messages, User Info and the summary divider', async () => {
    localStorage.setItem(SESSION_KEY, 's1');
    stubApi({
      'GET /api/session': () =>
        Response.json({
          sessionId: 's1',
          messages: [
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' },
            { role: 'assistant', content: 'a2' },
          ],
          userInfo: { profile: 'Name: An' },
          summary: { count: 2, content: 'Earlier: q1' },
        }),
    });
    render(<Chat />);

    await screen.findByText('a2');
    expect(screen.getByLabelText('User Profile')).toHaveProperty('value', 'Name: An');
    const divider = screen.getByText('Earlier conversation summarized').closest('details');
    expect(divider?.nextElementSibling?.textContent).toBe('q2');
  });

  it('starts a new session when the saved one is gone', async () => {
    localStorage.setItem(SESSION_KEY, 'expired');
    stubApi({
      'GET /api/session': () =>
        Response.json({ error: 'Unknown or expired session' }, { status: 404 }),
      'POST /api/session': newSession,
    });
    render(<Chat />);
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBe('s1'));
  });

  it('saves only the edited User Info part, and a bank save from the bot keeps the edit', async () => {
    const stream = eventStream();
    const calls = stubApi({
      'POST /api/session': newSession,
      'PUT /api/session/user-info': () => new Response(null, { status: 204 }),
      'POST /api/chat': () => stream.response,
    });
    render(<Chat />);
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBe('s1'));

    sendMessage('đúng rồi');
    await act(async () => {
      stream.push({ type: 'session', sessionId: 's1' });
      stream.push({ type: 'text', text: 'Dạ em ' });
    });
    await screen.findByText('Dạ em');
    // The user edits Settings while the reply streams.
    fireEvent.change(screen.getByLabelText('User Profile'), { target: { value: 'Name: An' } });
    await act(async () => {
      stream.push({ type: 'payment', payment: 'Ngân hàng: Vietcombank' });
      stream.push({ type: 'text', text: 'đã lưu ạ.' });
      stream.close();
    });
    await screen.findByText('Dạ em đã lưu ạ.');

    expect(screen.getByLabelText('User Profile')).toHaveProperty('value', 'Name: An');
    expect(screen.getByLabelText('User Payment')).toHaveProperty('value', 'Ngân hàng: Vietcombank');
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
        { sessionId: 's1', userInfo: { profile: 'Name: An' } },
      ]),
    );
  });

  it('uploads a QR image with the session id and shows the messages the server stored', async () => {
    const calls = stubApi({
      'POST /api/session': newSession,
      'POST /api/payment-qr': () =>
        Response.json({
          messages: [
            { role: 'user', content: '[Ảnh mã QR ngân hàng]' },
            { role: 'assistant', content: 'Dạ em đọc được từ mã QR: Vietcombank' },
          ],
        }),
    });
    const { container } = render(<Chat />);
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBe('s1'));

    const file = new File(['png'], 'qr.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });

    await screen.findByText('Dạ em đọc được từ mã QR: Vietcombank');
    expect(screen.getByText('[Ảnh mã QR ngân hàng]')).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/payment-qr')?.body).toMatchObject({ sessionId: 's1' });
  });

  it('moves User Info saved by the old version into the new session once', async () => {
    localStorage.setItem(OLD_USER_INFO_KEY, JSON.stringify({ profile: 'Name: An' }));
    const calls = stubApi({
      'POST /api/session': newSession,
      'PUT /api/session/user-info': () => new Response(null, { status: 204 }),
    });
    render(<Chat />);

    await waitFor(() => expect(localStorage.getItem(OLD_USER_INFO_KEY)).toBeNull());
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      sessionId: 's1',
      userInfo: { profile: 'Name: An' },
    });
    expect(screen.getByLabelText('User Profile')).toHaveProperty('value', 'Name: An');
  });
});
