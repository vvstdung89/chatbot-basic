import { useState } from 'react';
import {
  paymentReadBack,
  paymentReadFailed,
  QR_UPLOAD_MESSAGE,
  readChatEvents,
  trimHistory,
  type ChatMessage,
  type HistorySummary,
  type PaymentQrInfo,
  type UserInfo,
} from '@chatbot/core/client';

/**
 * The conversation: messages, sending (NDJSON events from /api/chat) and bank QR upload.
 * `onPayment` receives User Payment text saved by the update_bank_info tool.
 */
export function useChat(userInfo: UserInfo, onPayment: (payment: string) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where the server summarized older messages: they stay visible, the model sees the summary.
  // `count` is an index into `messages`.
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  // Bank details read from an uploaded QR, sent with each message until saved or replaced.
  const [pendingPayment, setPendingPayment] = useState<PaymentQrInfo | null>(null);

  async function send(content: string) {
    if (!content || pending) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setPending(true);
    setError(null);

    // Only the newest messages within the request limits are sent.
    const { messages: sent, dropped } = trimHistory(history);
    let reply = '';
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: sent,
          userInfo,
          pendingPayment: pendingPayment ?? undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setSummary(null);

      for await (const event of readChatEvents(res.body)) {
        if (event.type === 'text') {
          reply += event.text;
          setMessages([...history, { role: 'assistant', content: reply }]);
        } else if (event.type === 'summary') {
          setSummary({ count: dropped + event.count, content: event.content });
        } else if (event.type === 'payment') {
          onPayment(event.payment);
          setPendingPayment(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Drop the empty placeholder; keep a partial reply if one arrived.
      if (!reply) setMessages(history);
    } finally {
      setPending(false);
    }
  }

  /** Reads a bank QR image on the server, then reads it back in the chat for confirmation. */
  async function uploadQr(file: File) {
    if (pending) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content: QR_UPLOAD_MESSAGE }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setPending(true);
    setError(null);

    let reply: string;
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/payment-qr', { method: 'POST', body: form });
      const data = (await res.json().catch(() => null)) as unknown;
      if (res.ok) {
        reply = paymentReadBack(data as PaymentQrInfo);
        setPendingPayment(data as PaymentQrInfo);
      } else {
        reply = paymentReadFailed(
          (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`,
        );
      }
    } catch (err) {
      reply = paymentReadFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
    setMessages([...history, { role: 'assistant', content: reply }]);
  }

  return { messages, pending, error, summary, send, uploadQr };
}
