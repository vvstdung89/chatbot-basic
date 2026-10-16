// No Node imports: the browser reads chat events with readChatEvents (`@chatbot/core/client`).
import type { ChatEvent } from '../types';

/** One NDJSON line of the POST /api/chat response. */
export function encodeChatEvent(event: ChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Reads the ChatEvents of an NDJSON body. A network chunk can end mid-line or mid-character. */
export async function* readChatEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // stream: true keeps a UTF-8 character cut between chunks for the next decode.
      const lines = (buffer + decoder.decode(value, { stream: true })).split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line) yield JSON.parse(line) as ChatEvent;
    }
    buffer += decoder.decode();
    if (buffer) yield JSON.parse(buffer) as ChatEvent;
  } finally {
    // Stops the download when the caller stops reading early.
    await reader.cancel().catch(() => {});
  }
}
