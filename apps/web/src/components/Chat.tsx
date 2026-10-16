'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage, HistorySummary } from '@chatbot/core';
import {
  MAX_USER_INFO_LENGTH,
  USER_INFO_SECTIONS,
  type UserInfo,
  type UserInfoKey,
} from '@chatbot/core/user-info';

const USER_INFO_STORAGE_KEY = 'chatbot.userInfo';

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo>({});
  // Where the server summarized older messages: they stay visible, the model sees the summary.
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ messages: history, userInfo }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      const header = res.headers.get('X-Chat-Summary');
      setSummary(header ? (JSON.parse(decodeURIComponent(header)) as HistorySummary) : null);

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        reply += value;
        setMessages([...history, { role: 'assistant', content: reply }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Drop the empty placeholder; keep a partial reply if one arrived.
      if (!reply) setMessages(history);
    } finally {
      setPending(false);
    }
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
