import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../types';
import { encodeChatEvent, readChatEvents } from './events';

const events: ChatEvent[] = [
  { type: 'summary', count: 2, content: '- Anh Minh, đơn QX-7781' },
  { type: 'text', text: 'Dạ em ' },
  { type: 'payment', payment: 'Ngân hàng: Vietcombank\nSố tài khoản: 0123456789' },
  { type: 'text', text: 'đã cập nhật ạ.' },
];

/** A byte stream split into pieces of `size` bytes, cutting lines and UTF-8 characters. */
function streamOf(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const event of readChatEvents(stream)) out.push(event);
  return out;
}

describe('encodeChatEvent', () => {
  it('writes one JSON line per event', () => {
    expect(encodeChatEvent({ type: 'text', text: 'a\nb' })).toBe(
      '{"type":"text","text":"a\\nb"}\n',
    );
  });
});

describe('readChatEvents', () => {
  it.each([[1], [7], [1000]])('reads events back from %i-byte pieces', async (size) => {
    expect(await collect(streamOf(events.map(encodeChatEvent).join(''), size))).toEqual(events);
  });

  it('reads a last line without a newline', async () => {
    expect(await collect(streamOf('{"type":"text","text":"x"}', 5))).toEqual([
      { type: 'text', text: 'x' },
    ]);
  });
});
