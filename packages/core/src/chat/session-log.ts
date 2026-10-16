import type { ChatMessage } from '../types';
import type { TraceCallback, TraceEvent } from './trace';

/**
 * Session log files: one Markdown file per conversation that a person reads top to bottom. Built
 * from the same trace events as the JSON trace; the caller decides where `write` puts the text.
 * Full, unmasked content (development only, see apps/web/src/lib/session-log.ts).
 */

/** First line of a new session file (each section carries its own time). */
export function sessionLogHeader(sessionId: string): string {
  return `# Session ${sessionId}\n\n`;
}

/**
 * A trace callback for one chat request: collects its events and writes one section when the
 * request ends (`request.end`, `request.error`, `request.abort`). Requests that never reached a
 * session (400, 409) are not written. A reply that arrives after the request ended (cancelled
 * streams) is written as a short addendum.
 */
export function createSessionLog({
  requestId,
  write,
  now = () => new Date(),
}: {
  requestId: string;
  write: (sessionId: string, markdown: string) => void;
  now?: () => Date;
}): TraceCallback {
  const events: { at: number; event: TraceEvent }[] = [];
  let sessionId: string | undefined;
  let written = false;

  return (event) => {
    const at = now().getTime();
    if (event.type === 'turn.start') sessionId = String(event.sessionId);
    if (written) {
      if (sessionId && event.type === 'turn.end') write(sessionId, renderLateReply(event));
      return;
    }
    events.push({ at, event });
    if (!event.type.startsWith('request.') || event.type === 'request.start') return;
    written = true;
    if (sessionId) write(sessionId, renderTurn(requestId, events));
  };
}

/** The section for a bank QR upload (the upload does not go through the chat pipeline). */
export function renderQrUpload({
  time,
  status,
  error,
  messages,
}: {
  time: Date;
  status: number;
  error?: string;
  messages: ChatMessage[];
}): string {
  return section([
    `## QR upload · ${formatTime(time)}`,
    ...messages.map(
      (m) => `**${m.role === 'user' ? 'User' : 'Assistant'}**\n\n${quote(m.content)}`,
    ),
    error
      ? `Result: ❌ ${status}: ${error}`
      : `Result: ✅ ${status}: bank details pending confirmation`,
  ]);
}

function renderTurn(requestId: string, events: { at: number; event: TraceEvent }[]): string {
  const start = events[0]!.at;
  const rows: string[] = [];
  const details: string[] = [];
  let message = '';
  let reply: string | undefined;
  let result = '';

  for (const { at, event } of events) {
    const content = (event.content ?? {}) as Record<string, unknown>;
    const row = (text: string) => rows.push(`| ${at - start} | ${cell(text)} |`);

    switch (event.type) {
      case 'request.start':
      case 'history.start':
        break;
      case 'turn.start':
        message = String(content.message ?? '');
        if (event.newSession) row('new session');
        break;
      case 'history.ready': {
        const summarized = Number(event.summarized ?? 0);
        row(
          `history: ${plural(Number(event.messages), 'message')} sent to the model` +
            (summarized > 0 ? `, ${summarized} older ones summarized` : ''),
        );
        break;
      }
      case 'summary.start':
        row(`summarizing ${event.messages} older messages`);
        break;
      case 'summary.end':
        row(`summary ready: ${event.characters} characters`);
        break;
      case 'prompt.ready': {
        row(
          `system prompt: ${event.characters} characters · tools: ${list(event.tools)} · ` +
            `pending bank details: ${event.pendingPayment ? 'yes' : 'no'}`,
        );
        const messages = (content.messages ?? []) as ChatMessage[];
        const system = messages.find((m) => m.role === 'system');
        if (system) details.push(block('System prompt', system.content));
        break;
      }
      case 'model.start':
        row(
          event.phase === 'summary'
            ? `summary model call (${event.model})`
            : `model round ${event.round} (${event.model}): ${plural(Number(event.messages), 'message')}, tools: ${list(event.tools)}`,
        );
        break;
      case 'model.end': {
        const what =
          event.phase === 'summary' ? 'summary model call' : `model round ${event.round}`;
        const output = Number(event.toolCalls)
          ? plural(Number(event.toolCalls), 'tool call')
          : `${event.characters} characters`;
        row(`${what} done in ${event.durationMs} ms: ${event.finishReason}, ${output}`);
        break;
      }
      case 'tool.start':
        row(
          `→ ${event.tool} ` +
            (typeof content.arguments === 'string' ? content.arguments : '(arguments not traced)'),
        );
        break;
      case 'retrieval.end': {
        const found = (event.results ?? []) as { file: string; heading: string; score: number }[];
        row(
          `search "${content.query}": ` +
            (found.length
              ? found
                  .map(
                    (r) =>
                      `${[r.file, r.heading].filter(Boolean).join(' › ')} (${r.score.toFixed(2)})`,
                  )
                  .join(', ')
              : 'nothing found'),
        );
        break;
      }
      case 'tool.end':
        row(
          `← ${event.tool}: ${event.status === 'ok' ? 'ok' : `**${event.status}**`} in ${event.durationMs} ms`,
        );
        if (typeof content.result === 'string') {
          details.push(block(`${event.tool} result (round ${event.round})`, content.result));
        }
        break;
      case 'response.first_text':
        row('first text to the user');
        break;
      case 'provider.error':
      case 'provider.abort':
        row(
          `provider ${event.type === 'provider.abort' ? 'stopped' : 'error'} (round ${event.round}): ` +
            String(content.error ?? ''),
        );
        break;
      case 'turn.end':
        reply = String(content.reply ?? '');
        for (const action of (content.bank ?? []) as { action: string; details?: string }[]) {
          row(
            action.action === 'proposed'
              ? `bank details proposed (pending, not saved): ${action.details}`
              : action.action === 'saved'
                ? `bank details saved: ${action.details}`
                : 'pending bank details cancelled',
          );
        }
        if (typeof content.summary === 'string') {
          details.push(block('Conversation summary', content.summary));
        }
        break;
      case 'request.end':
        result = `Result: ✅ ${event.status} in ${((at - start) / 1000).toFixed(1)} s`;
        break;
      case 'request.error':
        result = `Result: ❌ ${event.status}: ${String(content.error ?? '')}`;
        break;
      case 'request.abort':
        result = 'Result: ⚠️ cancelled by the client';
        break;
      default: {
        const { type, content: _content, ...rest } = event;
        row(`${type} ${JSON.stringify(rest)}`);
      }
    }
  }

  return section([
    `## Turn · ${formatTime(new Date(start))} · request ${requestId.slice(0, 8)}`,
    `**User**\n\n${quote(message)}`,
    `| +ms | Step |\n| ---: | --- |\n${rows.join('\n')}`,
    ...details,
    ...(reply === undefined ? [] : [`**Assistant**\n\n${reply ? quote(reply) : '_(no reply)_'}`]),
    result,
  ]);
}

function renderLateReply(event: TraceEvent): string {
  const reply = String((event.content as { reply?: unknown } | undefined)?.reply ?? '');
  return section([
    `**Assistant** (after the request ended)\n\n${reply ? quote(reply) : '_(no reply)_'}`,
  ]);
}

function section(blocks: string[]): string {
  return `${blocks.filter(Boolean).join('\n\n')}\n\n`;
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

function block(title: string, text: string): string {
  return `<details><summary>${title}</summary>\n\n~~~text\n${text}\n~~~\n\n</details>`;
}

/** One table cell: no line breaks, `|` escaped. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' · ');
}

function list(value: unknown): string {
  return Array.isArray(value) && value.length ? value.join(', ') : 'none';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function formatTime(time: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${time.getFullYear()}-${p(time.getMonth() + 1)}-${p(time.getDate())} ` +
    `${p(time.getHours())}:${p(time.getMinutes())}:${p(time.getSeconds())}`
  );
}
