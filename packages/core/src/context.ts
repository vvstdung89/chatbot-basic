import { SUMMARY_PROMPT } from './prompt';
import type { ChatMessage, ChatProvider } from './types';

/** Token budget for the conversation history sent to the model (system prompt not counted). */
export const HISTORY_TOKEN_BUDGET = 4000;

/** Rough token count, ~3 characters per token for mixed Vietnamese/English; no tokenizer needed. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** The event that replaces the oldest `count` messages of the history. */
export interface HistorySummary {
  content: string;
  count: number;
}

export interface FitHistoryOptions {
  summarize: (messages: ChatMessage[]) => Promise<string>;
  budget?: number;
  /** Max tokens of older messages the summarizer reads (newest first). Default: 6 × budget. */
  summaryInputBudget?: number;
}

/**
 * Keeps the history within the budget. When over, the newest messages that fit in half the
 * budget are kept (at least the latest one, starting at a user message) and everything older is
 * summarized into a summary event.
 */
export async function fitHistory(
  messages: ChatMessage[],
  { summarize, budget = HISTORY_TOKEN_BUDGET, summaryInputBudget = budget * 6 }: FitHistoryOptions,
): Promise<{ messages: ChatMessage[]; summary?: HistorySummary }> {
  if (tokens(messages) <= budget) return { messages };

  let cut = messages.length - 1;
  let kept = estimateTokens(messages[cut]!.content);
  while (cut > 0) {
    const next = kept + estimateTokens(messages[cut - 1]!.content);
    if (next > budget / 2) break;
    kept = next;
    cut--;
  }
  while (cut < messages.length - 1 && messages[cut]!.role !== 'user') cut++;

  const older = messages.slice(0, cut);
  let start = older.length;
  let input = 0;
  while (start > 0) {
    const next = input + estimateTokens(older[start - 1]!.content);
    if (next > summaryInputBudget) break;
    input = next;
    start--;
  }

  const content = await summarize(older.slice(start));
  return { messages: messages.slice(cut), summary: { content, count: cut } };
}

/** Summarizes messages with the chat provider itself, using SUMMARY_PROMPT. */
export function createSummarizer(
  provider: ChatProvider,
  signal?: AbortSignal,
): (messages: ChatMessage[]) => Promise<string> {
  return async (messages) => {
    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    let summary = '';
    for await (const chunk of provider.streamChat(
      [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: transcript },
      ],
      { signal },
    )) {
      summary += chunk;
    }
    return summary.trim();
  };
}

function tokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}
