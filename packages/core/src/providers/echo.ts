import { setTimeout as sleep } from 'node:timers/promises';
import type { ChatMessage, ChatOptions, ChatProvider } from '../types';

export interface EchoProviderOptions {
  /** Delay between streamed words, to make streaming visible. Default 30ms. */
  delayMs?: number;
}

/** Development provider: streams the last user message back. Needs no API key. */
export class EchoProvider implements ChatProvider {
  readonly name = 'echo';
  readonly #delayMs: number;

  constructor(options: EchoProviderOptions = {}) {
    this.#delayMs = options.delayMs ?? 30;
  }

  async *streamChat(messages: ChatMessage[], { signal }: ChatOptions = {}): AsyncIterable<string> {
    const lastUser = messages.findLast((m) => m.role === 'user');
    const reply = lastUser ? `You said: ${lastUser.content}` : 'Say something!';

    for (const word of reply.match(/\S+\s*/g) ?? []) {
      signal?.throwIfAborted();
      if (this.#delayMs > 0) await sleep(this.#delayMs, undefined, { signal });
      yield word;
    }
  }
}
