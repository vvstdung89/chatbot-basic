import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENROUTER_MODEL,
  EchoProvider,
  getEmbedder,
  getProvider,
  OpenRouterProvider,
} from '.';

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of chunks) text += chunk;
  return text;
}

describe('EchoProvider', () => {
  const echo = new EchoProvider({ delayMs: 0 });

  it('streams the last user message back', async () => {
    const reply = await collect(
      echo.streamChat([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'You said: first' },
        { role: 'user', content: 'hello  there' },
      ]),
    );
    expect(reply).toBe('You said: hello  there');
  });

  it('prompts when there is no user message', async () => {
    expect(await collect(echo.streamChat([{ role: 'system', content: 'be nice' }]))).toBe(
      'Say something!',
    );
  });

  it('stops when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(echo.streamChat([{ role: 'user', content: 'hi' }], { signal: controller.signal })),
    ).rejects.toThrow();
  });
});

describe('getProvider', () => {
  it('defaults to OpenRouter with DeepSeek Flash', () => {
    const provider = getProvider({ OPENROUTER_API_KEY: 'sk-test' });
    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect((provider as OpenRouterProvider).model).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it('reads the model from OPENROUTER_MODEL, ignoring an empty value', () => {
    const custom = getProvider({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'x-ai/some-model' });
    expect((custom as OpenRouterProvider).model).toBe('x-ai/some-model');
    const empty = getProvider({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: '' });
    expect((empty as OpenRouterProvider).model).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it('requires OPENROUTER_API_KEY', () => {
    expect(() => getProvider({ CHAT_PROVIDER: 'openrouter' })).toThrow(
      'OPENROUTER_API_KEY is not set',
    );
  });

  it('selects a provider by CHAT_PROVIDER', () => {
    expect(getProvider({ CHAT_PROVIDER: 'echo' }).name).toBe('echo');
  });

  it('rejects unknown names, including Object prototype keys', () => {
    expect(() => getProvider({ CHAT_PROVIDER: 'nope' })).toThrow(/Unknown chat provider "nope"/);
    expect(() => getProvider({ CHAT_PROVIDER: 'constructor' })).toThrow(/Unknown chat provider/);
  });
});

describe('getEmbedder', () => {
  it('requires OPENROUTER_API_KEY', () => {
    expect(() => getEmbedder({})).toThrow('OPENROUTER_API_KEY is not set');
    expect(getEmbedder({ OPENROUTER_API_KEY: 'sk-test' })).toBeTypeOf('function');
  });
});
