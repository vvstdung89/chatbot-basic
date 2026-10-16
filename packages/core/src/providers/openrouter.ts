import OpenAI from 'openai';
import type { ChatMessage, ChatOptions, ChatProvider, ChatTool, Embedder } from '../types';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash';
export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'baai/bge-m3';

/** Tool-calling rounds per reply; after that the model must answer without tools. */
const MAX_TOOL_ROUNDS = 5;

export interface OpenRouterProviderOptions {
  apiKey: string;
  /** Any model id from https://openrouter.ai/models. Default: DeepSeek V4.1 Flash. */
  model?: string;
  baseURL?: string;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Streams replies from OpenRouter through its OpenAI-compatible API. */
export class OpenRouterProvider implements ChatProvider {
  readonly name = 'openrouter';
  readonly model: string;
  readonly #client: OpenAI;

  constructor({ apiKey, model, baseURL = OPENROUTER_BASE_URL }: OpenRouterProviderOptions) {
    this.model = model || DEFAULT_OPENROUTER_MODEL;
    this.#client = new OpenAI({ apiKey, baseURL });
  }

  /**
   * Streams the answer. When the model calls tools instead, runs them, sends the results back and
   * streams the next response, until the model answers without calling tools.
   */
  async *streamChat(
    messages: ChatMessage[],
    { signal, tools = [] }: ChatOptions = {},
  ): AsyncIterable<string> {
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = [...messages];
    // Models often write blank lines before (or alongside) a tool call; the reply starts at text.
    let started = false;

    for (let round = 0; ; round++) {
      const offerTools = tools.length > 0 && round < MAX_TOOL_ROUNDS;
      const stream = await this.#client.chat.completions.create(
        {
          model: this.model,
          messages: history,
          stream: true,
          ...(offerTools && { tools: tools.map(toOpenAITool) }),
        },
        { signal },
      );

      const calls = new Map<number, ToolCall>();
      for await (const chunk of stream) {
        // Reasoning arrives in a separate delta field; only the answer is streamed.
        const delta = chunk.choices[0]?.delta;
        const text = started ? delta?.content : delta?.content?.trimStart();
        if (text) {
          started = true;
          yield text;
        }
        // A tool call is announced with its id and name, then its arguments arrive in pieces.
        for (const part of delta?.tool_calls ?? []) {
          const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
          call.id ||= part.id ?? '';
          call.name ||= part.function?.name ?? '';
          call.arguments += part.function?.arguments ?? '';
          calls.set(part.index, call);
        }
      }
      if (calls.size === 0) return;

      history.push({
        role: 'assistant',
        content: null,
        tool_calls: [...calls.values()].map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      for (const call of calls.values()) {
        const content = await runTool(tools, call, signal);
        history.push({ role: 'tool', tool_call_id: call.id, content });
      }
    }
  }
}

export interface OpenRouterEmbedderOptions {
  apiKey: string;
  /** Any embedding model id from https://openrouter.ai/models. Default: BGE-M3 (multilingual). */
  model?: string;
  baseURL?: string;
}

/** Embeds texts through OpenRouter's OpenAI-compatible embeddings API. */
export function createOpenRouterEmbedder({
  apiKey,
  model,
  baseURL = OPENROUTER_BASE_URL,
}: OpenRouterEmbedderOptions): Embedder {
  const client = new OpenAI({ apiKey, baseURL });
  const embeddingModel = model || DEFAULT_OPENROUTER_EMBEDDING_MODEL;
  return async (texts, signal) => {
    const { data } = await client.embeddings.create(
      { model: embeddingModel, input: texts, encoding_format: 'float' },
      { signal },
    );
    return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  };
}

function toOpenAITool({ name, description, parameters }: ChatTool): OpenAI.Chat.ChatCompletionTool {
  return { type: 'function', function: { name, description, parameters } };
}

/** Runs one tool call; failures become an error result for the model rather than a failed reply. */
async function runTool(tools: ChatTool[], call: ToolCall, signal?: AbortSignal): Promise<string> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return `Error: unknown tool "${call.name}"`;
  try {
    return await tool.run(JSON.parse(call.arguments || '{}'), signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error(`[tools] ${call.name} failed:`, err);
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
