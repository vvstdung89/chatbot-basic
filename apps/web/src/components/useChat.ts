import { useCallback, useEffect, useRef, useState } from 'react';
import {
  QR_UPLOAD_MESSAGE,
  readChatEvents,
  type ChatMessage,
  type HistorySummary,
  type UserInfo,
  type UserInfoKey,
} from '@chatbot/core/client';

const SESSION_KEY = 'chatbot.sessionId';
/** Where the version before server-side sessions kept User Info; moved to the session once. */
const OLD_USER_INFO_KEY = 'chatbot.userInfo';
const SAVE_DELAY_MS = 400;

interface SessionView {
  sessionId: string;
  messages: ChatMessage[];
  userInfo: UserInfo;
  summary?: HistorySummary;
}

/**
 * The conversation, kept on the server: the browser only stores the session id. Restores the
 * session on load, sends `{ sessionId, message }`, reads the NDJSON events, uploads bank QR
 * images and saves User Info edits.
 */
export function useChat() {
  const sessionId = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInfo, setUserInfo] = useState<UserInfo>({});
  // Where the server summarized older messages: they stay visible, the model sees the summary.
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimers = useRef(new Map<UserInfoKey, ReturnType<typeof setTimeout>>());

  const rememberSession = (id: string) => {
    sessionId.current = id;
    storage.set(SESSION_KEY, id);
  };

  // Restore the saved session, or start a new one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = storage.get(SESSION_KEY);
      const view =
        (saved &&
          (await requestJson<SessionView>(`/api/session?id=${encodeURIComponent(saved)}`))) ||
        (await requestJson<SessionView>('/api/session', { method: 'POST' }));
      if (!view || cancelled) return;
      rememberSession(view.sessionId);
      setMessages(view.messages);
      setUserInfo(view.userInfo);
      setSummary(view.summary ?? null);
      await moveOldUserInfo(view, (moved) => setUserInfo((current) => ({ ...moved, ...current })));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Shows the edit now; saves just this part a moment after the user stops typing. */
  const updateUserInfo = useCallback((key: UserInfoKey, value: string) => {
    setUserInfo((current) => ({ ...current, [key]: value }));
    clearTimeout(saveTimers.current.get(key));
    saveTimers.current.set(
      key,
      setTimeout(() => {
        if (sessionId.current) void putUserInfo(sessionId.current, { [key]: value });
      }, SAVE_DELAY_MS),
    );
  }, []);

  async function send(content: string) {
    if (!content || pending) return;
    let history: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setPending(true);
    setError(null);

    let reply = '';
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.current ?? undefined, message: content }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setSummary(null);

      for await (const event of readChatEvents(res.body)) {
        if (event.type === 'session') {
          // A different id means the old session expired: the server starts from this message.
          if (sessionId.current && event.sessionId !== sessionId.current) {
            history = [{ role: 'user', content }];
          }
          rememberSession(event.sessionId);
        } else if (event.type === 'text') {
          reply += event.text;
          setMessages([...history, { role: 'assistant', content: reply }]);
        } else if (event.type === 'summary') {
          setSummary({ count: event.count, content: event.content });
        } else if (event.type === 'payment') {
          // Already saved on the server; only the Settings panel needs to show it.
          setUserInfo((current) => ({ ...current, payment: event.payment }));
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

  /** Sends a bank QR image; the server reads it and stores the messages it shows. */
  async function uploadQr(file: File) {
    if (pending) return;
    setMessages([
      ...messages,
      { role: 'user', content: QR_UPLOAD_MESSAGE },
      { role: 'assistant', content: '' },
    ]);
    setPending(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('sessionId', sessionId.current ?? '');
      form.append('image', file);
      const res = await fetch('/api/payment-qr', { method: 'POST', body: form });
      const data = (await res.json().catch(() => null)) as {
        messages?: ChatMessage[];
        error?: string;
      } | null;
      if (data?.messages) {
        setMessages([...messages, ...data.messages]);
      } else {
        setMessages(messages);
        setError(data?.error ?? `Request failed (${res.status})`);
      }
    } catch (err) {
      setMessages(messages);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return { messages, pending, error, summary, userInfo, updateUserInfo, send, uploadQr };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function putUserInfo(id: string, userInfo: UserInfo) {
  return fetch('/api/session/user-info', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: id, userInfo }),
  });
}

/** User Info from the version that kept it in localStorage goes to an empty session, once. */
async function moveOldUserInfo(view: SessionView, show: (moved: UserInfo) => void) {
  const old = storage.get(OLD_USER_INFO_KEY);
  if (!old || Object.keys(view.userInfo).length > 0) return;
  try {
    const moved = JSON.parse(old) as UserInfo;
    if ((await putUserInfo(view.sessionId, moved)).ok) {
      show(moved);
      storage.remove(OLD_USER_INFO_KEY);
    }
  } catch {
    // Unreadable or not saved: try again on the next load.
  }
}

// localStorage can be missing or blocked (private windows); the chat still works without it.
const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not remembered across reloads.
    }
  },
  remove: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to do.
    }
  },
};
