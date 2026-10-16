import { describe, expect, it } from 'vitest';
import { createSessionLog, renderQrUpload, sessionLogHeader } from './session-log';
import type { TraceEvent } from './trace';

const START = new Date(2026, 9, 17, 9, 12, 5); // local time 2026-10-17 09:12:05

/** Feeds events to a session log, 10 ms apart; returns what it wrote. */
function run(events: TraceEvent[]) {
  const written: { sessionId: string; markdown: string }[] = [];
  let t = START.getTime();
  const log = createSessionLog({
    requestId: 'a68c119c-add0-4507-a79c-807aa9216689',
    write: (sessionId, markdown) => written.push({ sessionId, markdown }),
    now: () => new Date((t += 10) - 10),
  });
  for (const event of events) log(event);
  return written;
}

const turnStart = (message = 'hi', newSession = false): TraceEvent => ({
  type: 'turn.start',
  sessionId: 's1',
  newSession,
  content: { message },
});
const turnEnd = (content: Record<string, unknown>): TraceEvent => ({
  type: 'turn.end',
  sessionId: 's1',
  content: { bank: [], ...content },
});

describe('createSessionLog', () => {
  it('writes one readable section per request, when the request ends', () => {
    const written = run([
      { type: 'request.start' },
      turnStart('xin chào', true),
      { type: 'history.ready', messages: 1, summarized: 0 },
      {
        type: 'prompt.ready',
        characters: 693,
        tools: ['search_documents', 'update_bank_info'],
        pendingPayment: false,
        content: { messages: [{ role: 'system', content: 'You are Siêu Hoàn.' }] },
      },
      {
        type: 'model.start',
        phase: 'answer',
        round: 0,
        model: 'deepseek/deepseek-v4.1-flash',
        messages: 2,
        tools: ['search_documents', 'update_bank_info'],
      },
      {
        type: 'model.end',
        phase: 'answer',
        round: 0,
        durationMs: 2278,
        finishReason: 'stop',
        characters: 9,
        toolCalls: 0,
      },
      { type: 'response.first_text' },
      turnEnd({ reply: 'Dạ em chào anh.\nAnh cần gì ạ?' }),
      { type: 'request.end', status: 200 },
    ]);

    expect(written).toHaveLength(1);
    expect(written[0]?.sessionId).toBe('s1');
    const md = written[0]!.markdown;
    expect(md).toContain('## Turn · 2026-10-17 09:12:05 · request a68c119c\n');
    expect(md).toContain('**User**\n\n> xin chào\n');
    expect(md).toContain('| +ms | Step |\n| ---: | --- |\n');
    for (const row of [
      '| 10 | new session |',
      '| 20 | history: 1 message sent to the model |',
      '| 30 | system prompt: 693 characters · tools: search_documents, update_bank_info · pending bank details: no |',
      '| 40 | model round 0 (deepseek/deepseek-v4.1-flash): 2 messages, tools: search_documents, update_bank_info |',
      '| 50 | model round 0 done in 2278 ms: stop, 9 characters |',
      '| 60 | first text to the user |',
    ]) {
      expect(md).toContain(row);
    }
    expect(md).toContain(
      '<details><summary>System prompt</summary>\n\n~~~text\nYou are Siêu Hoàn.\n~~~\n\n</details>',
    );
    expect(md).toContain('**Assistant**\n\n> Dạ em chào anh.\n> Anh cần gì ạ?\n');
    expect(md).toContain('Result: ✅ 200 in 0.1 s');
  });

  it('shows tool calls, search results, the summary and bank actions', () => {
    const md = run([
      { type: 'request.start' },
      turnStart('hoàn tiền bao lâu?'),
      { type: 'summary.start', messages: 4 },
      { type: 'model.start', phase: 'summary', round: 0, model: 'm', messages: 2, tools: [] },
      {
        type: 'model.end',
        phase: 'summary',
        round: 0,
        durationMs: 900,
        finishReason: 'stop',
        characters: 120,
        toolCalls: 0,
      },
      { type: 'summary.end', characters: 120 },
      { type: 'history.ready', messages: 3, summarized: 4 },
      {
        type: 'tool.start',
        round: 0,
        callId: 'c1',
        tool: 'search_documents',
        content: { arguments: '{"query":"hoàn | tiền"}' },
      },
      {
        type: 'retrieval.end',
        results: [{ file: 'faq.md', heading: 'FAQ › Hoàn tiền', score: 0.71234 }],
        content: { query: 'hoàn | tiền' },
      },
      {
        type: 'tool.end',
        round: 0,
        callId: 'c1',
        tool: 'search_documents',
        status: 'ok',
        durationMs: 140,
        content: { result: '[faq.md › FAQ › Hoàn tiền]\n9 ngày' },
      },
      { type: 'tool.start', round: 1, callId: 'c2', tool: 'update_bank_info' },
      {
        type: 'tool.end',
        round: 1,
        callId: 'c2',
        tool: 'update_bank_info',
        status: 'error',
        durationMs: 2,
      },
      turnEnd({
        reply: 'ok',
        summary: '- Anh Minh, đơn QX-7781',
        bank: [
          { action: 'proposed', details: 'Ngân hàng: Vietcombank\nSố tài khoản: 0123456789' },
          { action: 'cancelled' },
        ],
      }),
      { type: 'request.end', status: 200 },
    ])[0]!.markdown;

    for (const row of [
      '| summarizing 4 older messages |',
      '| summary model call (m) |',
      '| summary model call done in 900 ms: stop, 120 characters |',
      '| summary ready: 120 characters |',
      '| history: 3 messages sent to the model, 4 older ones summarized |',
      '| → search_documents {"query":"hoàn \\| tiền"} |',
      '| search "hoàn \\| tiền": faq.md › FAQ › Hoàn tiền (0.71) |',
      '| ← search_documents: ok in 140 ms |',
      '| → update_bank_info (arguments not traced) |',
      '| ← update_bank_info: **error** in 2 ms |',
      '| bank details proposed (pending, not saved): Ngân hàng: Vietcombank · Số tài khoản: 0123456789 |',
      '| pending bank details cancelled |',
    ]) {
      expect(md).toContain(row);
    }
    expect(md).toContain(
      '<details><summary>search_documents result (round 0)</summary>\n\n~~~text\n[faq.md › FAQ › Hoàn tiền]\n9 ngày\n~~~',
    );
    expect(md).toContain(
      '<details><summary>Conversation summary</summary>\n\n~~~text\n- Anh Minh, đơn QX-7781\n~~~',
    );
  });

  it('records provider errors and the failed status', () => {
    const md = run([
      { type: 'request.start' },
      turnStart(),
      { type: 'provider.error', phase: 'answer', round: 0, content: { error: '401 invalid key' } },
      turnEnd({ reply: '' }),
      { type: 'request.error', status: 502, content: { error: 'openrouter: 401 invalid key' } },
    ])[0]!.markdown;

    expect(md).toContain('| provider error (round 0): 401 invalid key |');
    expect(md).toContain('**Assistant**\n\n_(no reply)_');
    expect(md).toContain('Result: ❌ 502: openrouter: 401 invalid key');
  });

  it('marks cancelled requests and adds a reply that arrives after the request ended', () => {
    const written = run([
      { type: 'request.start' },
      turnStart(),
      { type: 'request.abort' },
      turnEnd({ reply: 'partial' }),
    ]);

    expect(written[0]!.markdown).toContain('Result: ⚠️ cancelled by the client');
    expect(written[1]!.markdown).toContain('**Assistant** (after the request ended)\n\n> partial');
  });

  it('writes nothing for requests that never reached a session (400, 409)', () => {
    expect(run([{ type: 'request.start' }, { type: 'request.error', status: 400 }])).toEqual([]);
  });
});

describe('renderQrUpload', () => {
  const messages = [
    { role: 'user' as const, content: '[Ảnh mã QR ngân hàng]' },
    { role: 'assistant' as const, content: 'Dạ em đọc được từ mã QR:\n- Ngân hàng: Vietcombank' },
  ];

  it('shows the result and the two chat messages', () => {
    const md = renderQrUpload({ time: START, status: 200, messages });
    expect(md).toContain('## QR upload · 2026-10-17 09:12:05\n');
    expect(md).toContain('Result: ✅ 200: bank details pending confirmation');
    expect(md).toContain('**User**\n\n> [Ảnh mã QR ngân hàng]');
    expect(md).toContain('**Assistant**\n\n> Dạ em đọc được từ mã QR:\n> - Ngân hàng: Vietcombank');
  });

  it('shows why the QR could not be read', () => {
    const md = renderQrUpload({ time: START, status: 422, error: 'No QR code found', messages });
    expect(md).toContain('Result: ❌ 422: No QR code found');
  });
});

describe('sessionLogHeader', () => {
  it('starts the file with the session id only (each section has its own time)', () => {
    expect(sessionLogHeader('s1')).toBe('# Session s1\n\n');
  });
});
