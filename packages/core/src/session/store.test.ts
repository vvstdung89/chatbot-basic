import { describe, expect, it } from 'vitest';
import { MAX_HISTORY_LENGTH, MAX_MESSAGES } from '../chat/validate';
import { MemorySessionStore } from './store';

const HOUR = 60 * 60 * 1000;

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('MemorySessionStore', () => {
  it('creates sessions with unguessable ids and returns copies', async () => {
    const store = new MemorySessionStore();
    const a = await store.create();
    const b = await store.create();

    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ messages: [], userInfo: {} });

    a.messages.push({ role: 'user', content: 'not saved' });
    expect((await store.get(a.id))?.messages).toEqual([]);
  });

  it('saves sessions and returns undefined for unknown ids', async () => {
    const store = new MemorySessionStore();
    const session = await store.create();
    session.messages.push({ role: 'user', content: 'hi' });
    session.userInfo = { profile: 'Name: An' };
    await store.save(session);

    expect(await store.get(session.id)).toMatchObject({
      messages: [{ role: 'user', content: 'hi' }],
      userInfo: { profile: 'Name: An' },
    });
    expect(await store.get('unknown')).toBeUndefined();
  });

  it('expires sessions after 24 hours without activity', async () => {
    const time = clock();
    const store = new MemorySessionStore({ now: time.now });
    const session = await store.create();

    time.advance(23 * HOUR);
    expect(await store.get(session.id)).toBeDefined(); // activity: the timer restarts
    time.advance(23 * HOUR);
    expect(await store.get(session.id)).toBeDefined();
    time.advance(24 * HOUR + 1);
    expect(await store.get(session.id)).toBeUndefined();
  });

  it('drops the least recently used session when full', async () => {
    const store = new MemorySessionStore({ maxSessions: 2 });
    const a = await store.create();
    const b = await store.create();
    await store.get(a.id); // a is now more recent than b
    const c = await store.create();

    expect(await store.get(b.id)).toBeUndefined();
    expect(await store.get(a.id)).toBeDefined();
    expect(await store.get(c.id)).toBeDefined();
  });

  it('keeps the newest history within the limits and shifts the summary divider', async () => {
    const store = new MemorySessionStore();
    const session = await store.create();
    session.messages = Array.from({ length: MAX_MESSAGES + 3 }, (_, i) => ({
      role: 'user' as const,
      content: String(i),
    }));
    session.summary = { count: 10, content: 'S' };
    await store.save(session);

    const saved = await store.get(session.id);
    expect(saved?.messages).toHaveLength(MAX_MESSAGES);
    expect(saved?.messages[0]?.content).toBe('3');
    expect(saved?.summary).toEqual({ count: 7, content: 'S' });

    // 4 × 50,000 characters is over the 150,000 total: the oldest one is dropped.
    session.messages = Array.from({ length: 4 }, (_, i) => ({
      role: 'user' as const,
      content: String(i).padEnd(MAX_HISTORY_LENGTH / 3, '.'),
    }));
    await store.save(session);
    expect((await store.get(session.id))?.messages.map((m) => m.content[0])).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('lets one request at a time work on a session', async () => {
    const store = new MemorySessionStore();
    const { id } = await store.create();

    expect(await store.tryLock(id)).toBe(true);
    expect(await store.tryLock(id)).toBe(false);
    await store.unlock(id);
    expect(await store.tryLock(id)).toBe(true);
  });
});
