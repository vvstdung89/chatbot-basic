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
