import type { HistorySummary } from '../chat/context';
import { runChat, type RunChatOptions } from '../chat/run-chat';
import { emitTrace } from '../chat/trace';
import type { ChatTurnRequest } from '../chat/validate';
import { formatPaymentInfo, type PaymentQrInfo } from '../payment/vietqr';
import type { ChatEvent, ChatMessage } from '../types';
import type { Session, SessionStore } from './store';

/** Thrown when the session already has a reply in progress (HTTP 409). */
export class SessionBusyError extends Error {
  override name = 'SessionBusyError';
}

export interface ChatTurnOptions extends RunChatOptions {
  store: SessionStore;
}

/** What happened to the user's bank details in a turn (for the session log). */
export type BankAction =
  { action: 'proposed' | 'saved'; details: string } | { action: 'cancelled' };

/**
 * One message in a server-side conversation: load (or start) the session, run the chat pipeline
 * over its history, then store the new messages, the summary, saved User Payment and pending bank
 * details. The first event is always `session`; `pending_payment` stays on the server.
 *
 * Like runChat, nothing is yielded until the provider produced its first result, so failures
 * before the reply reject the first `next()`. One request at a time per session.
 */
export async function* chatTurn(
  { sessionId, message }: ChatTurnRequest,
  { store, ...options }: ChatTurnOptions,
): AsyncGenerator<ChatEvent> {
  const found = sessionId ? await store.get(sessionId) : undefined;
  const session = found ?? (await store.create());
  if (!(await store.tryLock(session.id))) throw new SessionBusyError('This conversation is busy');
  // For the session log: the turn as a person reads it (see chat/session-log.ts).
  emitTrace(options.onTrace, {
    type: 'turn.start',
    sessionId: session.id,
    newSession: !found,
    content: { message },
  });

  const userMessage: ChatMessage = { role: 'user', content: message };
  // What this turn changes; merged into the latest stored session at the end.
  let reply = '';
  let summary: HistorySummary | null | undefined; // undefined = unchanged, null = none this turn
  let payment: string | undefined;
  let pending: PaymentQrInfo | null | undefined; // undefined = unchanged
  const bank: BankAction[] = [];

  try {
    const events = runChat(
      {
        messages: [...session.messages, userMessage],
        userInfo: session.userInfo,
        ...(session.pendingPayment && { pendingPayment: session.pendingPayment }),
      },
      options,
    );
    let next = await events.next();
    summary = null; // the reply started: the summary is whatever this turn sends
    yield { type: 'session', sessionId: session.id };

    for (; !next.done; next = await events.next()) {
      const event = next.value;
      if (event.type === 'text') reply += event.text;
      else if (event.type === 'summary') summary = { count: event.count, content: event.content };
      else if (event.type === 'payment') {
        [payment, pending] = [event.payment, null];
        bank.push({ action: 'saved', details: event.payment });
      } else if (event.type === 'pending_payment') {
        pending = event.pending;
        bank.push(
          event.pending
            ? { action: 'proposed', details: formatPaymentInfo(event.pending) }
            : { action: 'cancelled' },
        );
        continue;
      }
      yield event;
    }
  } finally {
    emitTrace(options.onTrace, {
      type: 'turn.end',
      sessionId: session.id,
      content: { reply, ...(summary && { summary: summary.content }), bank },
    });
    const latest = (await store.get(session.id)) ?? session;
    latest.messages.push(
      userMessage,
      ...(reply ? [{ role: 'assistant' as const, content: reply }] : []),
    );
    applyTurn(latest, { summary, payment, pending });
    await store.save(latest);
    await store.unlock(session.id);
  }
}

function applyTurn(
  session: Session,
  {
    summary,
    payment,
    pending,
  }: { summary?: HistorySummary | null; payment?: string; pending?: PaymentQrInfo | null },
) {
  if (summary) session.summary = summary;
  else if (summary === null) delete session.summary;
  if (payment !== undefined) session.userInfo = { ...session.userInfo, payment };
  if (pending === null) delete session.pendingPayment;
  else if (pending) session.pendingPayment = pending;
}
