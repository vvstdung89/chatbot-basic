import OpenAI from 'openai';
import type { ChatMessage, ChatOptions, ChatProvider, ChatTool, Embedder } from '../types';
import { emitTrace } from '../chat/trace';

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
  /**
   * Upstream providers OpenRouter should not route to (slugs such as "sail-research"), e.g. ones
   * that drop optional tool arguments. See docs/bug_report/openrouter-provider-drops-tool-arguments.md.
   */
  ignoreProviders?: string[];
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
  readonly ignoreProviders: readonly string[];
  readonly #client: OpenAI;

  constructor({
    apiKey,
    model,
    baseURL = OPENROUTER_BASE_URL,
    ignoreProviders = [],
  }: OpenRouterProviderOptions) {
    this.model = model || DEFAULT_OPENROUTER_MODEL;
    this.ignoreProviders = ignoreProviders;
    this.#client = new OpenAI({ apiKey, baseURL });
  }

  /**
   * Streams the answer. When the model calls tools instead, runs them, sends the results back and
   * streams the next response, until the model answers without calling tools.
   */
  async *streamChat(
    messages: ChatMessage[],
    { signal, tools = [], onTrace }: ChatOptions = {},
  ): AsyncIterable<string> {
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = [...messages];
    // Models often write blank lines before (or alongside) a tool call; the reply starts at text.
    let started = false;

    let round = 0;
    try {
      for (; ; round++) {
        const offerTools = tools.length > 0 && round < MAX_TOOL_ROUNDS;
        emitTrace(onTrace, {
          type: 'model.start',
          phase: 'answer',
          round,
          model: this.model,
          messages: history.length,
          tools: offerTools ? tools.map((tool) => tool.name) : [],
        });
        const start = performance.now();
        const stream = await this.#client.chat.completions.create(
          {
            model: this.model,
            messages: history,
            stream: true,
            ...(offerTools && { tools: tools.map(toOpenAITool) }),
            // OpenRouter routing option, passed through in the request body.
            ...(this.ignoreProviders.length > 0 && {
              provider: { ignore: [...this.ignoreProviders] },
            }),
          },
          { signal },
        );

        const calls = new Map<number, ToolCall>();
        let finishReason: string | null = null;
        let characters = 0;
        for await (const chunk of stream) {
          finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
          // Reasoning arrives in a separate delta field; only the answer is streamed.
          const delta = chunk.choices[0]?.delta;
          const text = started ? delta?.content : delta?.content?.trimStart();
          if (text) {
            characters += text.length;
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
        emitTrace(onTrace, {
          type: 'model.end',
          phase: 'answer',
          round,
          durationMs: Math.round(performance.now() - start),
          finishReason,
          characters,
          toolCalls: calls.size,
        });
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
          const meta = { round, callId: call.id, tool: call.name };
          const privateTool = call.name === 'update_bank_info';
          emitTrace(onTrace, {
            type: 'tool.start',
            ...meta,
            ...(!privateTool && { content: { arguments: call.arguments } }),
          });
          const toolStart = performance.now();
          let content: string;
          try {
            content = await runTool(tools, call, signal);
          } catch (err) {
            emitTrace(onTrace, {
              type: 'tool.end',
              ...meta,
              status: signal?.aborted ? 'aborted' : 'error',
              durationMs: Math.round(performance.now() - toolStart),
            });
            throw err;
          }
          emitTrace(onTrace, {
            type: 'tool.end',
            ...meta,
            status: content.startsWith('Error:') ? 'error' : 'ok',
            durationMs: Math.round(performance.now() - toolStart),
            ...(!privateTool && { content: { result: content } }),
          });
          history.push({ role: 'tool', tool_call_id: call.id, content });
        }
      }
    } catch (err) {
      emitTrace(onTrace, {
        type: signal?.aborted ? 'provider.abort' : 'provider.error',
        phase: 'answer',
        round,
        content: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
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
