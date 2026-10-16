import type { HistorySummary } from '../chat/context';
import type { UserInfo } from '../chat/user-info';
import { trimHistory } from '../chat/validate';
import type { PaymentQrInfo } from '../payment/vietqr';
import type { ChatMessage } from '../types';

/** One user's conversation, kept on the server. The browser only knows the id. */
export interface Session {
  /** Random UUID; the only key until there is login. */
  id: string;
  /** User and assistant text, oldest first. */
  messages: ChatMessage[];
  userInfo: UserInfo;
  /** Bank details waiting for the user's confirmation (QR upload or a typed proposal). */
  pendingPayment?: PaymentQrInfo;
  /** Latest summary of older messages, for the UI divider. */
  summary?: HistorySummary;
  updatedAt: number;
}

/** Where sessions live. Async so Redis or a database can implement it later. */
export interface SessionStore {
  create(): Promise<Session>;
  /** A copy of the session; undefined when unknown or expired. */
  get(id: string): Promise<Session | undefined>;
  save(session: Session): Promise<void>;
  /** Marks the session busy; false when another request already holds it. */
  tryLock(id: string): Promise<boolean>;
  unlock(id: string): Promise<void>;
}

export interface MemorySessionStoreOptions {
  /** Idle time before a session expires. Default 24 hours. */
  ttlMs?: number;
  /** Sessions kept; the least recently used is dropped beyond this. Default 1,000. */
  maxSessions?: number;
  now?: () => number;
}

/**
 * Sessions in server memory: lost on restart and not shared between server processes. Each
 * session keeps the newest history within the request limits (the model never reads further back).
 */
export class MemorySessionStore implements SessionStore {
  // Map order = least recently used first.
  readonly #sessions = new Map<string, Session>();
  readonly #locked = new Set<string>();
  readonly #ttlMs: number;
  readonly #maxSessions: number;
  readonly #now: () => number;

  constructor({
    ttlMs = 24 * 60 * 60 * 1000,
    maxSessions = 1000,
    now = Date.now,
  }: MemorySessionStoreOptions = {}) {
    this.#ttlMs = ttlMs;
    this.#maxSessions = maxSessions;
    this.#now = now;
  }

  async create(): Promise<Session> {
    const session: Session = { id: crypto.randomUUID(), messages: [], userInfo: {}, updatedAt: 0 };
    await this.save(session);
    return structuredClone(this.#sessions.get(session.id)!);
  }

  async get(id: string): Promise<Session | undefined> {
    const session = this.#sessions.get(id);
    if (!session) return undefined;
    if (this.#now() - session.updatedAt > this.#ttlMs) {
      this.#sessions.delete(id);
      return undefined;
    }
    session.updatedAt = this.#now();
    this.#touch(session);
    return structuredClone(session);
  }

  async save(session: Session): Promise<void> {
    const { messages, dropped } = trimHistory(session.messages);
    // The divider moves up with the dropped messages (to the top if they were all summarized).
    const summary = session.summary && {
      ...session.summary,
      count: Math.max(0, session.summary.count - dropped),
    };
    const saved: Session = {
      ...structuredClone(session),
      messages: structuredClone(messages),
      updatedAt: this.#now(),
    };
    if (summary) saved.summary = summary;
    else delete saved.summary;
    this.#touch(saved);
    for (const oldest of this.#sessions.keys()) {
      if (this.#sessions.size <= this.#maxSessions) break;
      this.#sessions.delete(oldest);
    }
  }

  async tryLock(id: string): Promise<boolean> {
    if (this.#locked.has(id)) return false;
    this.#locked.add(id);
    return true;
  }

  async unlock(id: string): Promise<void> {
    this.#locked.delete(id);
  }

  #touch(session: Session) {
    this.#sessions.delete(session.id);
    this.#sessions.set(session.id, session);
  }
}
