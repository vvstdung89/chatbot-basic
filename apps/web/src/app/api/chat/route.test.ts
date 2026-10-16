// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TraceEvent } from '@chatbot/core';
import { POST } from './route';

const { provider } = vi.hoisted(() => ({ provider: { name: 'fake', streamChat: vi.fn() } }));
vi.mock('@/lib/knowledge', () => ({ knowledge: { files: () => [] } }));
vi.mock('@chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@chatbot/core')>()),
  getProvider: () => provider,
}));

let records: TraceEvent[];
beforeEach(() => {
  records = [];
  vi.stubEnv('CHAT_DEBUG', '1');
  vi.stubEnv('CHAT_DEBUG_CONTENT', '1');
  vi.stubEnv('NODE_ENV', 'production');
  vi.spyOn(console, 'info').mockImplementation((line: string) => records.push(JSON.parse(line)));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  provider.streamChat.mockImplementation(async function* () {
    yield 'hello';
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const request = () =>
  new Request('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'PRIVATE 0123456789' }] }),
  });

describe('chat request traces', () => {
  it('correlates concurrent requests, ends after streaming and excludes content in production', async () => {
    const responses = await Promise.all([POST(request()), POST(request())]);
    for (const response of responses) {
      expect(await response.text()).toBe('{"type":"text","text":"hello"}\n');
      const events = records.filter(
        (event) => event.requestId === response.headers.get('x-request-id'),
      );
      expect(events[0]?.type).toBe('request.start');
      expect(events.at(-1)).toMatchObject({ type: 'request.end', status: 200 });
      expect(events.filter((event) => event.type === 'request.end')).toHaveLength(1);
    }
    expect(responses[0]!.headers.get('x-request-id')).not.toBe(
      responses[1]!.headers.get('x-request-id'),
    );
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
  });

  it('is silent when disabled', async () => {
    vi.stubEnv('CHAT_DEBUG', '0');
    const response = await POST(request());
    await response.text();
    expect(response.headers.has('x-request-id')).toBe(false);
    expect(records).toEqual([]);
  });

  it('captures masked content only when enabled in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await (await POST(request())).text();
    expect(JSON.stringify(records)).toContain('PRIVATE [redacted]');
    expect(JSON.stringify(records)).not.toContain('0123456789');
  });

  it('traces validation failures with the same response request ID', async () => {
    const response = await POST(
      new Request('http://localhost/api/chat', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(400);
    expect(records.at(-1)).toMatchObject({
      type: 'request.error',
      status: 400,
      requestId: response.headers.get('x-request-id'),
    });
  });

  it.each([false, true])('traces provider failures (after first text: %s)', async (midstream) => {
    provider.streamChat.mockImplementation(async function* () {
      if (midstream) yield 'partial';
      throw new Error('provider failed');
    });
    const response = await POST(request());
    if (midstream) await expect(response.text()).rejects.toThrow('provider failed');
    else expect(response.status).toBe(502);
    expect(records.at(-1)).toMatchObject({ type: 'request.error', status: midstream ? 200 : 502 });
    expect(records.filter((event) => event.type === 'request.end')).toEqual([]);
  });

  it('records cancellation once without a success event', async () => {
    provider.streamChat.mockImplementation(async function* () {
      for (let i = 0; i < 100; i++) yield 'text';
    });
    const response = await POST(request());
    await response.body!.cancel();
    expect(records.filter((event) => event.type === 'request.abort')).toHaveLength(1);
    expect(records.filter((event) => event.type === 'request.end')).toEqual([]);
  });
});
