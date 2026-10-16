# Code map

Where things live and how a chat request moves through them. Update this file whenever you add,
move or rename code.

## Request flow

The conversation lives on the server in a **session** (`session/store.ts`, in memory). The browser
keeps only the session id (`localStorage`): on load `GET /api/session?id=…` (or `POST /api/session`)
restores messages, User Info and the summary divider; Settings edits go to
`PUT /api/session/user-info` (only the parts sent).

```
useChat.send ── POST /api/chat { sessionId?, message }
  ▶ app/api/chat/route.ts (HTTP only)
      parseChatTurn(body)                          chat/validate.ts        → 400
      getProvider(process.env)                     providers/index.ts      → 500
      chatTurn(turn, { store: sessions, ... })     session/chat-turn.ts
        load or create the session, lock it                                → 409 when busy
        runChat({ history + message, userInfo,
                  pendingPayment }, options)       chat/run-chat.ts
          1. fitHistory: over 4,000 tokens →
             summarize older messages (LLM call)   chat/context.ts
          2. buildSystemPrompt({ userInfo, summary,
             pendingPayment }) + withSystemPrompt  chat/prompt.ts
          3. tools: search_documents (if documents) rag/knowledge.ts
                    update_bank_info               payment/bank-tool.ts
          4. provider.streamChat(messages, tools)  providers/<name>
             yields nothing until the first result, so failures reject the first next() → 502
          5. ChatEvents: summary first, tool events before the next text chunk
        yields "session" first; keeps "pending_payment" on the server
        finally: store user message + reply, summary, saved User Payment, pending details
                 (merged into the latest stored session), unlock
      encodeChatEvent → NDJSON stream             chat/events.ts
  ◀ readChatEvents(res.body) in useChat:
      {"type":"session"} → remember the session id
      {"type":"summary"} → divider before message #count
      {"type":"text"}    → appended to the last assistant message
      {"type":"payment"} → Settings shows the User Payment the server saved
```

Bank info is saved only after the user confirms (option B): `update_bank_info` step `propose`
(typed details → session's pending details, nothing saved) → the user replies → step `confirm`
(saves the details pending when the request arrived; refused after a propose / cancel in the same
turn) or `cancel`.

Bank QR upload (composer **QR** button):

```
useChat.uploadQr ── POST /api/payment-qr (multipart "sessionId" + "image") ▶ app/api/payment-qr/route.ts
      session id, session exists, not busy                                  → 400 / 404 / 409
      type PNG/JPEG/WebP, ≤ 5 MB                                            → 400 + messages
      decodeQrImage: sharp → jsqr                  payment/qr-image.ts      → 422 + messages
      parseVietQR: EMVCo + CRC + banks.json        payment/vietqr.ts        → 422 + messages
      session: pendingPayment = info; messages += "[Ảnh mã QR ngân hàng]" + paymentReadBack(info)
  ◀ { messages } shown in the chat; the user then confirms or declines in a message
```

Client disconnect aborts summarizing, generation and tools through `request.signal`.

Readable session logs: `CHAT_LOG_DIR` (development only) writes one Markdown file per session,
`<CHAT_LOG_DIR>/<sessionId>.md`. The chat route passes `createSessionLog` (`chat/session-log.ts`)
as `onTrace` instead of the terminal JSON trace; it collects one request's trace events (plus
`turn.start` / `turn.end` from `chatTurn`: message, new session, reply, summary, bank actions) and
writes one section when the request ends. The QR route appends a `renderQrUpload` section. Full,
unmasked text; `apps/web/logs/` is git-ignored.

Optional diagnostics: `CHAT_DEBUG=1` creates a request-scoped `onTrace` callback in the chat route,
adds `X-Request-Id` to the response, and logs JSON through `chat/trace.ts`. The callback follows
`runChat` into summarization, the provider tool loop and document search. Events include request ID
and elapsed milliseconds; model/tool events carry round/call identifiers and durations. The route
records completion only when the stream finishes, or records an error/cancellation instead.
`CHAT_DEBUG_CONTENT=1` includes content only in development; payment prompt fields and bank tool
payloads are omitted, and long digit sequences are masked. Diagnostic events are separate from
`ChatEvent` and are never sent in the NDJSON stream.

At Node server startup, `src/instrumentation.ts` awaits `knowledge.prepare()` before requests
are accepted. `src/lib/knowledge.ts` keeps the instance on `globalThis` so the startup hook and
chat route reuse one in-memory index per process. Startup errors are logged; search retries.
Document changes trigger reindexing on the next search; a process restart prepares a fresh index.

Tool loop inside `OpenRouterProvider.streamChat` (step 4):

```
model streams text ───────▶ yielded (leading blank lines dropped)
model streams tool_calls ─▶ runTool() ─▶ e.g. search_documents.run({ query })
                         ◀─ tool result appended to history
repeat (max 5 rounds, then no tools offered) until the model answers with text only
```

## apps/web: Next.js app (`@chatbot/web`)

| File                                     | Contents                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/page.tsx`                       | Home page: heading + `<Chat />`                                                                                                                                                                                                                                            |
| `src/app/layout.tsx`                     | Root HTML shell, page metadata, imports `globals.css`                                                                                                                                                                                                                      |
| `src/app/globals.css`                    | All styles: theme vars, `.page`, `.chat`, `.messages`, `.settings`, `.message`, `.history-summary`, `.error`, `.composer`                                                                                                                                                  |
| `src/app/api/chat/route.ts`              | `POST`: `parseChatTurn`, `getProvider`, `chatTurn` with the shared session store, NDJSON response (`toNdjsonStream`); 400 / 409 / 500 / 502; optional tracing                                                                                                              |
| `src/app/api/payment-qr/route.ts`        | `POST` bank QR upload for a session: `decodeQrImage`, `parseVietQR`; stores pending details and the two chat messages; image kept in memory only                                                                                                                           |
| `src/app/api/session/route.ts`           | `POST` new session (201), `GET ?id=` restore (`sessionView`: messages, User Info, summary; never pending details); 400 / 404                                                                                                                                               |
| `src/app/api/session/user-info/route.ts` | `PUT` partial User Info update (only the parts sent); 400 / 404                                                                                                                                                                                                            |
| `src/instrumentation.ts`                 | Node server startup hook: awaits `knowledge.prepare()`, logs the section count or a retryable failure                                                                                                                                                                      |
| `src/lib/knowledge.ts`                   | Process-wide `KnowledgeBase` for `knowledge/`, shared by instrumentation and routes, using `getEmbedder(process.env)`                                                                                                                                                      |
| `src/lib/sessions.ts`                    | Process-wide `MemorySessionStore` shared by the routes (`globalThis`), `sessionView`                                                                                                                                                                                       |
| `src/lib/session-log.ts`                 | `sessionLogDir()` (`CHAT_LOG_DIR`, development only), `appendSessionLog()` (file header, never throws)                                                                                                                                                                     |
| `knowledge/`                             | Documents (`.md`, `.txt`) for `search_documents`; read from `process.cwd()/knowledge`                                                                                                                                                                                      |
| `src/components/Chat.tsx`                | Client component: message list with the summary divider, the error, and the parts below                                                                                                                                                                                    |
| `src/components/useChat.ts`              | The conversation in the browser: session id in `localStorage`, restore / create on load, `send` (`{ sessionId, message }`, NDJSON events), `uploadQr`, `updateUserInfo` (shows at once, `PUT` per part after 400 ms); moves User Info from the old `localStorage` key once |
| `src/components/UserInfoSettings.tsx`    | Settings panel: one text box per `USER_INFO_SECTIONS` entry                                                                                                                                                                                                                |
| `src/components/Composer.tsx`            | Message input (max `MAX_MESSAGE_LENGTH`), Send, and the QR button / file picker                                                                                                                                                                                            |
| `next.config.ts`                         | `transpilePackages: ['@chatbot/core']`                                                                                                                                                                                                                                     |
| `vitest.config.ts`                       | Web unit / component tests: jsdom, `@/` alias (e2e excluded)                                                                                                                                                                                                               |
| `tsconfig.json`                          | Path alias `@/*` → `src/*`                                                                                                                                                                                                                                                 |

## packages/core: chat engine and features (`@chatbot/core`)

Ships TypeScript source; no build step. Entry points:

- `@chatbot/core` → `src/index.ts`: everything, for server code.
- `@chatbot/core/client` → `src/client.ts`: browser-safe code only. `client.test.ts` fails if
  anything reachable from it imports `node:*`, `openai`, `sharp` or `jsqr`.
- `@chatbot/core/qr-image` → `src/payment/qr-image.ts`: server only (sharp), separate so other
  routes don't load sharp.

| File                          | Contents                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                | `ChatRole`, `ChatMessage`, `ChatOptions` (`signal`, `tools`), `ChatProvider`, `ChatTool` (`name`, `description`, `parameters` JSON Schema, `run`), `Embedder`, `ChatEvent`                                                                                                                |
| `src/chat/run-chat.ts`        | `runChat({ messages, userInfo, pendingPayment }, { provider, knowledge?, signal, onTrace })` → `AsyncGenerator<ChatEvent>`: the chat pipeline (flow above); `ChatRequest`                                                                                                                 |
| `src/chat/validate.ts`        | `parseChatTurn` (`{ sessionId?, message }`, message ≤ `MAX_MESSAGE_LENGTH`), `parseSessionId`, `parseUserInfo`, `trimHistory` (history limits `MAX_MESSAGES`, `MAX_HISTORY_LENGTH`), `ChatRequestError`                                                                                   |
| `src/chat/prompt.ts`          | `SYSTEM_PROMPT` (the guardrail text, edit it here), `SUMMARY_PROMPT`; `buildSystemPrompt({ userInfo, summary, pendingPayment })`: prompt + sections in order (User Info, Conversation Summary, Pending Bank Details); `withSystemPrompt` puts it first and drops client `system` messages |
| `src/chat/context.ts`         | History budget: `HISTORY_TOKEN_BUDGET` (4,000), `estimateTokens` (chars / 3), `fitHistory` (newest messages within half the budget, rest summarized into `{ count, content }`), `createSummarizer`                                                                                        |
| `src/chat/events.ts`          | `encodeChatEvent` (one NDJSON line), `readChatEvents(body)` (browser-safe reader)                                                                                                                                                                                                         |
| `src/chat/trace.ts`           | `TraceEvent`, `TraceCallback`, `emitTrace` (isolates callback errors), `createTrace` (JSON records, request ID, elapsed time, optional masked content)                                                                                                                                    |
| `src/chat/session-log.ts`     | `createSessionLog({ requestId, write })` → trace callback that renders one Markdown section per request (step table, details blocks, reply, result); `renderQrUpload`, `sessionLogHeader`                                                                                                 |
| `src/chat/user-info.ts`       | `USER_INFO_SECTIONS` (key + label of each User Info part), `UserInfo`, `MAX_USER_INFO_LENGTH`                                                                                                                                                                                             |
| `src/session/store.ts`        | `Session` (history, User Info, pending bank details, summary), `SessionStore` (async, for Redis / a database later), `MemorySessionStore` (24 h idle expiry, 1,000 sessions LRU, history trimmed, `tryLock` / `unlock`)                                                                   |
| `src/session/chat-turn.ts`    | `chatTurn(turn, { store, ...runChat options })`: one message in a stored conversation (flow above); `SessionBusyError`                                                                                                                                                                    |
| `src/rag/knowledge.ts`        | `chunkDocument` (by heading, then paragraphs ≤ 1,500 chars), `KnowledgeBase` (`files()`, `prepare()`, `search(query)`; in-memory index rebuilt when files change), `searchDocumentsTool`                                                                                                  |
| `src/payment/vietqr.ts`       | VietQR/EMVCo: `parseVietQR` (CRC check, BIN/account from GUID `A000000727`, name from tag 59), `PaymentQrError`, `findBank`, `normalizeAccountName`, `formatPaymentInfo`, chat texts `QR_UPLOAD_MESSAGE` / `paymentReadBack` / `paymentReadFailed`, `PaymentQrInfo`                       |
| `src/payment/banks.json`      | 75 banks (`bin`, `code`, `shortName`, `name`) from api.vietqr.io/v2/banks, names in NFC                                                                                                                                                                                                   |
| `src/payment/bank-tool.ts`    | `updateBankInfoTool({ pending, onPropose, onConfirm, onCancel })` → `update_bank_info` with steps `propose` (typed details, `findBank`; nothing saved) / `confirm` (saves the details pending when the request arrived; refused after propose / cancel in the same turn) / `cancel`       |
| `src/payment/qr-image.ts`     | `decodeQrImage(image)`: sharp (EXIF rotate, ≤ 1600 px, RGBA) + jsqr → QR text or null                                                                                                                                                                                                     |
| `src/providers/index.ts`      | Provider registry, `getProvider(env)` by `CHAT_PROVIDER` (default `openrouter`; `OPENROUTER_IGNORE_PROVIDERS`, default `DEFAULT_IGNORED_PROVIDERS`), `getEmbedder(env)`, `requireEnv`                                                                                                     |
| `src/providers/openrouter.ts` | `OpenRouterProvider` (`openai` SDK; answer text only; tool-call loop with `MAX_TOOL_ROUNDS`, `runTool`; `ignoreProviders` → OpenRouter `provider.ignore`), `createOpenRouterEmbedder`, default model ids                                                                                  |
| `src/providers/echo.ts`       | `EchoProvider`: streams `You said: …`; no API key; ignores tools                                                                                                                                                                                                                          |

## Tests (Vitest, `pnpm test`)

| File                                             | Covers                                                                                                                                                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/client.test.ts`               | Nothing reachable from `client.ts` imports server-only code (and the check detects `index.ts`)                                                                                                                                                     |
| `packages/core/src/chat/trace.test.ts`           | Trace correlation, metadata-only logging, content masking, callback error isolation                                                                                                                                                                |
| `packages/core/src/chat/session-log.test.ts`     | Session log rendering: steps, search hits, tool results, summary, bank actions, errors, cancel + late reply, no session, QR section                                                                                                                |
| `apps/web/src/app/api/chat/route.test.ts`        | Request correlation, disabled tracing, development/production content policy, validation/provider/stream errors, cancellation                                                                                                                      |
| `apps/web/src/app/api/session/route.test.ts`     | Session routes: create, restore, 404 / 400, pending details never returned, partial User Info `PUT`, chat 409 when busy                                                                                                                            |
| `packages/core/src/chat/run-chat.test.ts`        | `runChat` with a fake provider: prompt, tools, event order, summary, pending / confirm / cancel events, failure before the reply                                                                                                                   |
| `packages/core/src/chat/events.test.ts`          | `encodeChatEvent` / `readChatEvents`, with lines and UTF-8 characters split across chunks                                                                                                                                                          |
| `packages/core/src/chat/validate.test.ts`        | `parseChatTurn`, `parseSessionId`, `parseUserInfo`, `trimHistory`                                                                                                                                                                                  |
| `packages/core/src/session/store.test.ts`        | `MemorySessionStore`: copies, expiry, LRU eviction, history limits + divider shift, lock                                                                                                                                                           |
| `packages/core/src/session/chat-turn.test.ts`    | `chatTurn`: session event, continued conversations, unknown ids, busy (409), failures (stored message, partial reply, summary kept), summary stored, option B over two turns, cancel, same-turn confirm refused, Settings edit during a reply kept |
| `packages/core/src/chat/prompt.test.ts`          | `withSystemPrompt`, `buildSystemPrompt` sections and order                                                                                                                                                                                         |
| `packages/core/src/chat/context.test.ts`         | `estimateTokens`, `fitHistory` (fake summarizer, small budgets), `createSummarizer`                                                                                                                                                                |
| `packages/core/src/rag/knowledge.test.ts`        | `chunkDocument`, `KnowledgeBase` (preparation, reuse, concurrency, retry, changes), `searchDocumentsTool`                                                                                                                                          |
| `packages/core/src/payment/vietqr.test.ts`       | `parseVietQR` on payloads with independently computed CRCs, `findBank`, chat texts, `formatPaymentInfo`                                                                                                                                            |
| `packages/core/src/payment/qr-image.test.ts`     | `decodeQrImage` on generated PNGs, a rotated JPEG photo, a blank image, non-image data                                                                                                                                                             |
| `packages/core/src/payment/bank-tool.test.ts`    | `updateBankInfoTool` steps: propose (no save, errors), confirm (only earlier pending details, not after propose / cancel in the same turn, once), cancel                                                                                           |
| `packages/core/src/providers/providers.test.ts`  | `EchoProvider`, `getProvider` (incl. `OPENROUTER_IGNORE_PROVIDERS`), `getEmbedder`                                                                                                                                                                 |
| `packages/core/src/providers/openrouter.test.ts` | `OpenRouterProvider` (tool loop, `provider.ignore` routing) and the embedder against a local fake server                                                                                                                                           |
| `apps/web/src/components/Chat.test.tsx`          | The chat UI with a stubbed API: new / restored / expired session, only `{ sessionId, message }` sent, User Info `PUT` per part and kept during a bank save, QR upload, old User Info moved once                                                    |
| `apps/web/e2e/api.e2e.test.ts` (`pnpm test:e2e`) | Production build + echo provider: page, sessions (create, follow-ups, restore, User Info, 404), 400 cases, QR upload into the session                                                                                                              |

## Config

| File                 | Contents                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env.example`       | Template for `apps/web/.env.local`: `CHAT_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_EMBEDDING_MODEL`, `OPENROUTER_IGNORE_PROVIDERS`, `CHAT_DEBUG`, `CHAT_DEBUG_CONTENT`, `CHAT_LOG_DIR` |
| `package.json`       | Root scripts, delegating to the workspaces                                                                                                                                                                     |
| `tsconfig.base.json` | Shared strict compiler options (incl. `noUncheckedIndexedAccess`)                                                                                                                                              |

## Where to change things

| To…                                                   | Edit                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change the guardrail prompt                           | `SYSTEM_PROMPT` in `packages/core/src/chat/prompt.ts`                                                                                                         |
| Add a feature to the chat request                     | Data in `Session` (`session/store.ts`) and how a turn changes it (`session/chat-turn.ts`), prompt section in `buildSystemPrompt`, tools / events in `runChat` |
| Add another tool                                      | A `ChatTool` in its feature folder (like `payment/bank-tool.ts`), added to `tools` in `chat/run-chat.ts`                                                      |
| Add a new kind of event for the browser               | `ChatEvent` in `types.ts`, emit it in `runChat` (or `chatTurn`), handle it in `useChat.ts`                                                                    |
| Keep sessions in Redis or a database                  | Implement `SessionStore` (`session/store.ts`) and use it in `apps/web/src/lib/sessions.ts`                                                                    |
| Skip unreliable OpenRouter upstreams                  | `OPENROUTER_IGNORE_PROVIDERS` (default `DEFAULT_IGNORED_PROVIDERS` in `providers/index.ts`)                                                                   |
| Add an LLM provider                                   | New `packages/core/src/providers/<name>.ts`, register it in `providers/index.ts`                                                                              |
| Change the default model                              | `DEFAULT_OPENROUTER_MODEL` in `openrouter.ts`, plus `.env.example` and README                                                                                 |
| Change the history budget or summary style            | `HISTORY_TOKEN_BUDGET` in `chat/context.ts`, `SUMMARY_PROMPT` in `chat/prompt.ts`                                                                             |
| Change message / history limits or session expiry     | `MAX_MESSAGE_LENGTH`, `MAX_MESSAGES`, `MAX_HISTORY_LENGTH` in `chat/validate.ts`; `MemorySessionStore` options                                                |
| Change QR chat texts or how the model saves bank info | `paymentReadBack` / `paymentReadFailed` in `payment/vietqr.ts`, tool description in `payment/bank-tool.ts`, Pending Bank Details section in `chat/prompt.ts`  |
| Refresh the bank list                                 | Re-fetch https://api.vietqr.io/v2/banks into `payment/banks.json` (`bin`, `code`, `shortName`, `name`, NFC)                                                   |
| Add or edit searchable documents                      | Files in `apps/web/knowledge/`                                                                                                                                |
| Change how documents are split, or how many results   | `MAX_CHUNK_LENGTH` / `search({ limit })` in `rag/knowledge.ts`                                                                                                |
| Add or rename a User Info part                        | `USER_INFO_SECTIONS` in `chat/user-info.ts` (UI and prompt follow)                                                                                            |
| Use core code in the browser                          | Export it from `src/client.ts` (the guard test checks it stays browser-safe)                                                                                  |
| Change status codes or streaming                      | `apps/web/src/app/api/chat/route.ts`                                                                                                                          |
| Change trace formatting or capture policy             | `packages/core/src/chat/trace.ts`, enablement and request lifecycle in `apps/web/src/app/api/chat/route.ts`                                                   |
| Change what the session log files show                | `packages/core/src/chat/session-log.ts` (rendering), `turn.start` / `turn.end` in `session/chat-turn.ts`, file writing in `apps/web/src/lib/session-log.ts`   |
| Change chat UI behaviour or look                      | `useChat.ts` / components in `apps/web/src/components/`, `globals.css`                                                                                        |

Sample searchable content: `apps/web/knowledge/faq.md` contains a Vietnamese Siêu Hoàn FAQ (17
questions). Its figures are invented and not marked as samples, so the assistant states them as
policy: replace them with confirmed policies before real use.

Feature specs, plans and progress notes live in `docs/feature/<feature>/` (`spec.md`, `plan.md`,
`progress.md`); bug reports in `docs/bug_report/<bug>.md`. See `AGENTS.md`.
