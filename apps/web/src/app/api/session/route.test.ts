// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { sessions } from '@/lib/sessions';
import { POST as chat } from '../chat/route';
import { POST as uploadQr } from '../payment-qr/route';
import { PUT } from './user-info/route';
import { GET, POST } from './route';

vi.mock('@/lib/knowledge', () => ({ knowledge: { files: () => [] } }));

const get = (id: string) => GET(new Request(`http://localhost/api/session?id=${id}`));
const put = (body: unknown) =>
  PUT(
    new Request('http://localhost/api/session/user-info', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );

describe('/api/session', () => {
  it('creates an empty session and returns it on GET', async () => {
    const created = await POST();
    expect(created.status).toBe(201);
    const { sessionId, ...rest } = (await created.json()) as { sessionId: string };
    expect(rest).toEqual({ messages: [], userInfo: {} });

    expect(await (await get(sessionId)).json()).toEqual({ sessionId, messages: [], userInfo: {} });
  });

  it('answers 404 for an unknown session and 400 for a malformed id', async () => {
    expect((await get('0b6c7c43-5f8e-4c6b-9f5e-2f1a5d3c7e11')).status).toBe(404);
    expect((await get('a%20b')).status).toBe(400);
  });

  it('never returns the pending bank details', async () => {
    const session = await sessions.create();
    session.pendingPayment = { bin: '970436', accountNumber: '0123456789', type: 'account' };
    await sessions.save(session);
    expect(await (await get(session.id)).json()).not.toHaveProperty('pendingPayment');
  });
});

describe('PUT /api/session/user-info', () => {
  it('replaces only the parts sent', async () => {
    const session = await sessions.create();
    session.userInfo = { payment: 'Ngân hàng: Vietcombank', profile: 'old' };
    await sessions.save(session);

    expect((await put({ sessionId: session.id, userInfo: { profile: 'Name: An' } })).status).toBe(
      204,
    );
    expect((await sessions.get(session.id))?.userInfo).toEqual({
      payment: 'Ngân hàng: Vietcombank',
      profile: 'Name: An',
    });
  });

  it.each([
    ['a missing session id', { userInfo: {} }, 400],
    ['bad User Info', { sessionId: 'abc', userInfo: { profile: 42 } }, 400],
    ['an unknown session', { sessionId: 'abc', userInfo: { profile: 'x' } }, 404],
  ])('rejects %s', async (_, body, status) => {
    expect((await put(body)).status).toBe(status);
  });
});

describe('POST /api/chat with a busy session', () => {
  it('answers 409 while another reply for the same session is in progress', async () => {
    vi.stubEnv('CHAT_PROVIDER', 'echo');
    const { id } = await sessions.create();
    await sessions.tryLock(id);

    const response = await chat(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ sessionId: id, message: 'hi' }),
      }),
    );

    expect(response.status).toBe(409);
    await sessions.unlock(id);
    vi.unstubAllEnvs();
  });
});

describe('session log for QR uploads (CHAT_LOG_DIR)', () => {
  it('adds a QR upload section with the result and the two chat messages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-logs-'));
    vi.stubEnv('CHAT_LOG_DIR', dir);
    vi.stubEnv('NODE_ENV', 'development');
    const { id } = await sessions.create();
    const form = new FormData();
    form.append('sessionId', id);
    form.append('image', new Blob(['not an image'], { type: 'image/png' }), 'qr.png');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await uploadQr(
      new Request('http://localhost/api/payment-qr', { method: 'POST', body: form }),
    );

    expect(response.status).toBe(422);
    const file = readFileSync(join(dir, `${id}.md`), 'utf8');
    expect(file).toContain('## QR upload · ');
    expect(file).toContain('> [Ảnh mã QR ngân hàng]');
    expect(file).toContain('Result: ❌ 422: Could not read the image');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
});
