import type { TraceCallback } from './chat/trace';
import type { PaymentQrInfo } from './payment/vietqr';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  /** Optional server-side diagnostics, separate from answer text. */
  onTrace?: TraceCallback;
  /** Aborts generation, e.g. when the client disconnects. */
  signal?: AbortSignal;
  /** Tools the model may call before answering. Providers without tool support ignore them. */
  tools?: ChatTool[];
}

/** A function the model can call; its text result is sent back to the model. */
export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
  run(args: unknown, signal?: AbortSignal): Promise<string>;
}

/** Turns texts into embedding vectors, one per text, in the same order. */
export type Embedder = (texts: string[], signal?: AbortSignal) => Promise<number[][]>;

/**
 * The contract every LLM backend implements. A provider streams the assistant's
 * reply as text chunks; transport (HTTP, CLI, ...) is the caller's concern.
 */
export interface ChatProvider {
  readonly name: string;
  streamChat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string>;
}

/** One line of the POST /api/chat NDJSON response (`pending_payment` stays on the server). */
export type ChatEvent =
  /** First event: the session this conversation is kept in (new when the sent id was unknown). */
  | { type: 'session'; sessionId: string }
  /** Older messages were summarized; the first `count` messages of the history are replaced. */
  | { type: 'summary'; count: number; content: string }
  /** A chunk of the assistant's reply. */
  | { type: 'text'; text: string }
  /** update_bank_info saved new User Payment text. */
  | { type: 'payment'; payment: string }
  /** update_bank_info proposed (details) or cancelled (null) the pending bank details. */
  | { type: 'pending_payment'; pending: PaymentQrInfo | null };
