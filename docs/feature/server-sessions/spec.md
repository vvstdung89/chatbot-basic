# Spec: server-side sessions

## Goal

The browser only sends a session id and the new message; the server keeps and manages the
conversation. The browser just displays. This removes the trust problem (the browser can no longer
send forged history, User Info or pending bank details) and is the base for option B (confirm
before saving bank info) and later login / a database.

First storage: in server memory, behind a `SessionStore` interface so Redis or Postgres can replace
it without touching the chat code.

## Session

One session = one user's conversation:

```ts
interface Session {
  id: string; // crypto.randomUUID(), unguessable; the only key (no login yet)
  messages: ChatMessage[]; // user + assistant text, oldest first
  userInfo: UserInfo; // moved from the browser's localStorage
  pendingPayment?: PaymentQrInfo; // QR details waiting for confirmation
  summary?: HistorySummary; // latest summary of older messages (for the UI divider)
  updatedAt: number;
}
```

## API

| Endpoint                     | Body                            | Response                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/session`          | –                               | 201 with a new empty session (same shape as GET); the browser calls it when it has no (valid) session yet                                                                                                                                                                                                      |
| `GET /api/session?id=…`      | –                               | `{ sessionId, messages, userInfo, summary? }`, or 404 when unknown / expired                                                                                                                                                                                                                                   |
| `PUT /api/session/user-info` | `{ sessionId, userInfo }`       | 204. Partial: only the parts sent are replaced, so a Settings edit never overwrites a User Payment saved by the bank tool                                                                                                                                                                                      |
| `POST /api/chat`             | `{ sessionId?, message }`       | NDJSON events. The first is always `{"type":"session","sessionId":"…"}` (a new session when the id is missing or unknown). Then `summary`, `text`, `payment` as today                                                                                                                                          |
| `POST /api/payment-qr`       | multipart `image` + `sessionId` | Reads the QR, stores the details as the session's pending details, appends `[Ảnh mã QR ngân hàng]` + the read-back to the history, returns `{ messages }` for display. When the QR can't be read the two messages (with the failure text) are stored too and returned with the 400 / 422 `{ error, messages }` |

Errors stay `{ error }`: 400 bad body (message 1–50,000 characters), 404 unknown session (GET,
PUT, QR), 409 when the session already has a reply in progress, 500 misconfigured, 502 provider
failed before replying.

## Server behaviour per chat request

1. Find or create the session; mark it busy (a second request for the same session gets 409).
2. Append the user message to the session history.
3. `runChat` with the session's history, User Info and pending details (unchanged pipeline:
   summary, prompt, tools, streaming).
4. `update_bank_info` updates the session's User Payment directly and clears its pending details;
   the `payment` event only tells the browser to refresh the Settings panel.
5. Append the assistant reply when the stream ends (the partial text if it failed after starting).
   Store the latest summary for the UI divider. These changes are merged into the latest stored
   session (a Settings edit made during the reply is kept). Release the busy mark.

## Browser

- Keeps only `sessionId` in `localStorage`. On load, `GET /api/session` restores messages, User
  Info and the summary divider; no or unknown / expired id → `POST /api/session`.
- User Info saved by the old version in `localStorage` is sent once to the new session, then
  removed.
- Sends `{ sessionId, message }`; reads NDJSON events as today; remembers `sessionId` from the
  `session` event.
- Settings panel loads User Info from the session and saves each edited part with `PUT`
  (debounced).
- QR button posts the image with `sessionId` and displays the returned messages.
- No more `trimHistory`, `pendingPayment` or User Info in the browser's requests.

## In-memory store limits

- A session expires after 24 hours without activity.
- At most 1,000 sessions; when full, the least recently used one is dropped.
- History keeps the newest 1,000 messages / 150,000 characters (the current request limits; the
  model never reads further back than ~26k tokens anyway).
- Lost when the server restarts, and only works with one server process. Both go away with a
  Redis / Postgres `SessionStore`.

## Unchanged

Chat pipeline (`runChat`), prompts, tools, RAG, summary rules, NDJSON event format (plus the new
`session` event), UI look.

## Out of scope

- Login / user accounts (the session id is the only key).
- A persistent database (next step, same interface).
- Option B (confirm before saving bank info): built right after, on top of this
  (`docs/feature/bank-info-confirm/`).
- Reusing the stored summary instead of recomputing it each request.
