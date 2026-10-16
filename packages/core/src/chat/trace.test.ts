import { describe, expect, it } from 'vitest';
import { createTrace, emitTrace } from './trace';

describe('tracing', () => {
  it('correlates records and omits content by default', () => {
    const lines: string[] = [];
    const trace = createTrace({ requestId: 'a', write: (line) => lines.push(line) });
    trace({ type: 'tool.start', round: 0, content: { arguments: 'secret' } });
    expect(JSON.parse(lines[0]!)).toEqual({
      requestId: 'a',
      elapsedMs: expect.any(Number),
      type: 'tool.start',
      round: 0,
    });
  });

  it('masks account numbers when content capture is enabled', () => {
    const lines: string[] = [];
    const trace = createTrace({
      requestId: 'b',
      captureContent: true,
      write: (line) => lines.push(line),
    });
    trace({ type: 'prompt.ready', content: { messages: [{ content: 'Account 0123456789' }] } });
    expect(lines[0]).not.toContain('0123456789');
    expect(lines[0]).toContain('[redacted]');
  });

  it('does not let a trace callback failure break the caller', () => {
    expect(() =>
      emitTrace(
        () => {
          throw new Error('logger failed');
        },
        { type: 'request.start' },
      ),
    ).not.toThrow();
  });
});
