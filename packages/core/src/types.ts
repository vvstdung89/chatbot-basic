export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
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

/** One line of the POST /api/chat NDJSON response. */
export type ChatEvent =
  /** Older messages were summarized; the first `count` sent messages are replaced. */
  | { type: 'summary'; count: number; content: string }
  /** A chunk of the assistant's reply. */
  | { type: 'text'; text: string }
  /** update_bank_info saved new User Payment text. */
  | { type: 'payment'; payment: string };
