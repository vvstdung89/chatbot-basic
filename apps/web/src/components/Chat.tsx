'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatEvent, ChatMessage, HistorySummary } from '@chatbot/core';
import {
  MAX_USER_INFO_LENGTH,
  USER_INFO_SECTIONS,
  type UserInfo,
  type UserInfoKey,
} from '@chatbot/core/user-info';
import {
  paymentReadBack,
  paymentReadFailed,
  QR_UPLOAD_MESSAGE,
  type PaymentQrInfo,
} from '@chatbot/core/vietqr';

const USER_INFO_STORAGE_KEY = 'chatbot.userInfo';

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo>({});
  // Where the server summarized older messages: they stay visible, the model sees the summary.
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  // Bank details read from an uploaded QR, sent with each message until the user confirms or
  // declines in the chat.
  const [pendingPayment, setPendingPayment] = useState<PaymentQrInfo | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Loaded after mount so the server render and first client render match.
  useEffect(() => {
    try {
      setUserInfo(JSON.parse(localStorage.getItem(USER_INFO_STORAGE_KEY) ?? '{}') ?? {});
    } catch {
      // Missing or unreadable storage: start empty.
    }
  }, []);

  function updateUserInfo(key: UserInfoKey, value: string) {
    const next = { ...userInfo, [key]: value };
    setUserInfo(next);
    try {
      localStorage.setItem(USER_INFO_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: the setting still applies until reload.
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || pending) return;

    const history: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setPending(true);
    setError(null);

    let reply = '';
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          userInfo,
          pendingPayment: pendingPayment ?? undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setSummary(null);

      // NDJSON: one ChatEvent per line; a read can end mid-line, so keep the rest for later.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = (buffer + value).split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === 'text') {
            reply += event.text;
            setMessages([...history, { role: 'assistant', content: reply }]);
          } else if (event.type === 'summary') {
            setSummary({ count: event.count, content: event.content });
          } else if (event.type === 'payment') {
            updateUserInfo('payment', event.payment);
            setPendingPayment(null);
          }
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

  return (
    <div className="chat">
      <details className="settings">
        <summary>Settings</summary>
        <fieldset>
          <legend>User Info</legend>
          {USER_INFO_SECTIONS.map(({ key, label }) => (
            <label key={key}>
              {label}
              <textarea
                value={userInfo[key] ?? ''}
                onChange={(e) => updateUserInfo(key, e.target.value)}
                maxLength={MAX_USER_INFO_LENGTH}
                rows={3}
              />
            </label>
          ))}
        </fieldset>
      </details>

      <div className="messages" aria-live="polite">
        {messages.length === 0 && <p className="empty">Send a message to start.</p>}
        {messages.map((m, i) => (
          <Fragment key={i}>
            {summary?.count === i && (
              <details className="history-summary">
                <summary>Earlier conversation summarized</summary>
                <p>{summary.content}</p>
              </details>
            )}
            <div className={`message ${m.role}`}>{m.content || '…'}</div>
          </Fragment>
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <form className="composer" onSubmit={send}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // allow picking the same file again
            if (file) void uploadQr(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={pending}
          aria-label="Upload bank QR image"
        >
          QR
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          aria-label="Message"
          autoFocus
        />
        <button type="submit" disabled={pending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
