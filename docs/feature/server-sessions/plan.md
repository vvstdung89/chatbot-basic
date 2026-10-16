# Plan: server-side sessions

1. Tests first: `packages/core/src/session/store.test.ts` for `MemorySessionStore` (create / get /
   save, 24 h expiry, LRU eviction at the limit, history cap, busy lock).
2. `packages/core/src/session/store.ts`: `Session`, `SessionStore` interface, `MemorySessionStore`.
3. Tests first: `session/chat-turn.test.ts`; then `session/chat-turn.ts`:
   `chatTurn(store, { sessionId?, message }, { provider, knowledge, signal })` →
   `AsyncGenerator<ChatEvent>`: session event, append the message, `runChat` over the stored
   session, apply `payment` to the session, store the reply and summary. `runChat` itself
   unchanged; `parseChatTurn(body)` replaces `parseChatRequest` for the HTTP body.
4. `apps/web/src/lib/sessions.ts`: one process-wide `MemorySessionStore` (like `lib/knowledge.ts`).
5. Routes: `/api/chat` (sessionId + message), new `GET /api/session`, new
   `PUT /api/session/user-info`, `/api/payment-qr` stores pending details and messages on the
   session.
6. UI: `useChat` sends `{ sessionId, message }`, restores the session on load; `useUserInfo`
   loads / saves through the API; QR upload displays returned messages. Update `Chat.test.tsx`
   first (stubbed API), then the code.
7. e2e (`pnpm test:e2e`): session created, history kept across requests, restore with GET,
   User Info PUT, 404 / 409 cases.
8. `CODEMAP.md`, `README.md` (API), progress; `pnpm test`, `pnpm typecheck`, `pnpm build`,
   `pnpm test:e2e`; live run; commit.
