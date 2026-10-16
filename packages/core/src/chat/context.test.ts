import { describe, expect, it } from 'vitest';
import { createSummarizer, estimateTokens, fitHistory } from './context';
import { SUMMARY_PROMPT } from './prompt';
import type { ChatMessage, ChatOptions, ChatProvider } from '../types';
import type { TraceEvent } from './trace';

// 3 characters ≈ 1 token, so `chars` 30 is 10 tokens.
const msg = (role: 'user' | 'assistant', chars: number, mark = ''): ChatMessage => ({
  role,
  content: mark + 'x'.repeat(chars - mark.length),
});

function fakeSummarize(summary = 'S') {
  const calls: ChatMessage[][] = [];
  const summarize = async (messages: ChatMessage[]) => {
    calls.push(messages);
    return summary;
  };
  return { summarize, calls };
}

describe('estimateTokens', () => {
  it('counts about 3 characters per token, rounding up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(2);
  });
});

describe('fitHistory', () => {
  it('keeps the history unchanged under budget', async () => {
    const { summarize, calls } = fakeSummarize();
    const messages = [msg('user', 30), msg('assistant', 30), msg('user', 30)];

    expect(await fitHistory(messages, { budget: 30, summarize })).toEqual({ messages });
    expect(calls).toEqual([]);
  });

  it('summarizes older messages, keeping the newest within half the budget from a user message', async () => {
    const { summarize, calls } = fakeSummarize();
    const messages = [
      msg('user', 30, 'u1'),
      msg('assistant', 30, 'a1'),
      msg('user', 30, 'u2'),
      msg('assistant', 30, 'a2'), // fits in half the budget, but kept history must start at a user
      msg('user', 15, 'u3'),
    ];

    expect(await fitHistory(messages, { budget: 30, summarize })).toEqual({
      messages: [messages[4]],
      summary: { content: 'S', count: 4 },
    });
    expect(calls).toEqual([messages.slice(0, 4)]);
  });

  it('always keeps the latest message, even when it alone is over half the budget', async () => {
    const { summarize, calls } = fakeSummarize();
    const messages = [msg('user', 30, 'u1'), msg('user', 150, 'u2')];

    expect(await fitHistory(messages, { budget: 30, summarize })).toEqual({
      messages: [messages[1]],
      summary: { content: 'S', count: 1 },
    });
    expect(calls).toEqual([[messages[0]]]);
  });

  it('gives the summarizer only the newest older messages that fit its input budget', async () => {
    const { summarize, calls } = fakeSummarize();
    const older = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', 30, `m${i}`),
    );
    const messages = [...older, msg('user', 15, 'last')];

    const fitted = await fitHistory(messages, { budget: 30, summaryInputBudget: 180, summarize });

    expect(fitted).toEqual({ messages: [messages[20]], summary: { content: 'S', count: 20 } });
    expect(calls).toEqual([older.slice(2)]);
  });
});

describe('createSummarizer', () => {
  it('marks provider events as summary calls', async () => {
    const events: TraceEvent[] = [];
    const provider: ChatProvider = {
      name: 'fake',
      async *streamChat(_messages, options) {
        options?.onTrace?.({ type: 'model.start', phase: 'answer', round: 0 });
        yield 'summary';
      },
    };
    expect(await createSummarizer(provider, undefined, (event) => events.push(event))([])).toBe(
      'summary',
    );
    expect(events).toEqual([
      { type: 'summary.start', messages: 0 },
      { type: 'model.start', phase: 'summary', round: 0 },
      { type: 'summary.end', characters: 7 },
    ]);
  });

  it('asks the provider for a summary of the transcript and returns the trimmed text', async () => {
    const seen: { messages?: ChatMessage[]; options?: ChatOptions } = {};
    const provider: ChatProvider = {
      name: 'fake',
      async *streamChat(messages, options) {
        Object.assign(seen, { messages, options });
        yield '  - An asked about ';
        yield 'order #1\n';
      },
    };
    const signal = new AbortController().signal;

    const summary = await createSummarizer(
      provider,
      signal,
    )([
      { role: 'user', content: 'Where is order #1?' },
      { role: 'assistant', content: 'It ships today.' },
    ]);

    expect(summary).toBe('- An asked about order #1');
    expect(seen.messages).toEqual([
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: 'User: Where is order #1?\n\nAssistant: It ships today.' },
    ]);
    expect(seen.options).toEqual({ signal });
  });
});
