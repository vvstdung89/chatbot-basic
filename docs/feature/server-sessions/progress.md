# Progress: server-side sessions

- [x] Owner decided: the browser sends only a session id; the server keeps the conversation
      (in memory for now)
- [x] Spec and plan written
- [x] Owner approved; also asked for option B on top. Spec adjusted while designing: `POST
/api/session`, partial User Info `PUT`, session changes merged into the latest stored
      session, failed QR messages stored too
- [x] `SessionStore` / `MemorySessionStore` (tests first; one wrong test expectation fixed: a
      single over-long message can never be stored, so the length limit is tested with 4 × 50k)
- [x] `chatTurn` + `parseChatTurn` / `parseSessionId` (tests first). `parseMessages`,
      `parseChatRequest`, `parsePendingPayment` removed (the browser no longer sends history);
      `ChatRequest` moved to `run-chat.ts`. Found while testing: a failed turn deleted the stored
      summary, and the store dropped a summary whose messages were all trimmed; both fixed with
      tests. 137 core tests, typecheck pass
- [x] Routes: `/api/chat` (`chatTurn`, 409 when busy), `POST`/`GET /api/session`,
      `PUT /api/session/user-info` (partial), `/api/payment-qr` (session pending details + chat
      messages); `lib/sessions.ts`. Route tests: session routes, chat 409; tracing tests updated
- [x] UI: `useChat` keeps only the session id, restores / creates the session, `PUT` per User Info
      part, QR upload shows server messages, old `localStorage` User Info moved once;
      `useUserInfo.ts` removed. 6 component tests written first (failed on the old UI)
- [x] e2e rewritten for sessions (11 pass); 139 core + 21 web tests, typecheck, build pass
- [x] Live run against OpenRouter (see `docs/feature/bank-info-confirm/progress.md`)
- [x] `README.md` (API), `CODEMAP.md`, `.env.example`; commit
