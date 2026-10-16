# Chatbot

A streaming chatbot in TypeScript. By default it talks to
[DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash) through
[OpenRouter](https://openrouter.ai). The LLM backend is pluggable: the app talks to a small
`ChatProvider` interface, and a built-in `echo` provider lets you run everything without an API key.

## Structure

```
.
├── apps/
│   └── web/                    Next.js app (UI + API)
│       ├── knowledge/          Documents (.md/.txt) the assistant can search
│       └── src/
│           ├── app/
│           ├── app/
│           │   ├── api/chat/route.ts        POST /api/chat (HTTP around chatTurn), NDJSON events
│           │   ├── api/session/             POST/GET a session, PUT User Info
│           │   ├── api/payment-qr/route.ts  POST /api/payment-qr, reads a bank QR image
│           │   ├── layout.tsx
│           │   ├── page.tsx
│           │   └── globals.css
│           ├── components/             Chat UI: Chat, Composer, UserInfoSettings, useChat (session)
│           ├── lib/knowledge.ts        Shared document index
│           └── instrumentation.ts      Indexes documents at server startup
├── packages/
│   └── core/                   Chat engine and features (@chatbot/core)
│       └── src/
│           ├── index.ts                Server entry
│           ├── client.ts               Browser entry (@chatbot/core/client)
│           ├── types.ts                ChatMessage, ChatProvider, ChatTool, ChatEvent, Embedder
│           ├── chat/                   run-chat.ts (the pipeline), validate.ts, prompt.ts (system
│           │                           prompt: edit it here), context.ts, events.ts, user-info.ts
│           ├── session/                store.ts (SessionStore, in memory), chat-turn.ts
│           ├── rag/                    knowledge.ts: document search (chunking, embeddings, tool)
│           ├── payment/                vietqr.ts, banks.json, bank-tool.ts, qr-image.ts
│           └── providers/
│               ├── index.ts            Provider registry (getProvider, getEmbedder)
│               ├── openrouter.ts       OpenRouter (default): chat with tool calls, embeddings
│               └── echo.ts             No-key development provider
├── docs/
│   ├── feature/<feature>/      spec.md, plan.md, progress.md per feature
│   └── bug_report/             one report per bug
├── package.json                Root scripts
├── pnpm-workspace.yaml
└── tsconfig.base.json          Shared compiler options
```

`@chatbot/core` exports TypeScript source directly (no build step); Next.js compiles it via
`transpilePackages`.

## Getting started

Requires Node 24+ and pnpm.

```sh
pnpm install
cp .env.example apps/web/.env.local   # then set OPENROUTER_API_KEY in it
pnpm dev                              # http://localhost:3000
```

## Configuration

Set these in `apps/web/.env.local`:

| Variable                      | Default                        | Purpose                                                             |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `CHAT_PROVIDER`               | `openrouter`                   | `openrouter`, or `echo` to run without a key                        |
| `OPENROUTER_API_KEY`          | (required for `openrouter`)    | Key from https://openrouter.ai/keys                                 |
| `OPENROUTER_MODEL`            | `deepseek/deepseek-v4.1-flash` | Any model id from https://openrouter.ai/models                      |
| `OPENROUTER_EMBEDDING_MODEL`  | `baai/bge-m3`                  | Embedding model for document search                                 |
| `OPENROUTER_IGNORE_PROVIDERS` | `sail-research`                | Upstream providers OpenRouter skips (comma-separated; empty = none) |

To follow DeepSeek's newest Flash release automatically, set
`OPENROUTER_MODEL=~deepseek/deepseek-flash-latest` (an OpenRouter alias; the model can change
under you).

## Debugging the agent flow

Set `CHAT_DEBUG=1` in `apps/web/.env.local`, restart `pnpm dev`, and send a message. The server
terminal prints one JSON trace record per step. Match its `requestId` to the chat response's
`X-Request-Id` header in browser DevTools → Network → `/api/chat`.

Records include `elapsedMs` since the request started, history counts, summary steps, offered tools,
model rounds (zero-based), tool call IDs/status/duration, retrieved files/headings/scores, first text,
and request completion/errors/cancellation. Model events use `phase: "summary"` or `"answer"`.
Tool error results are marked `status: "error"` even when the HTTP request succeeds. A
`request.error` with `status: 200` means the response stream failed after headers were sent.

```json
{"type":"tool.start","round":0,"callId":"call_1","tool":"search_documents","requestId":"...","elapsedMs":480}
{"type":"tool.end","round":0,"callId":"call_1","tool":"search_documents","status":"ok","durationMs":140,"requestId":"...","elapsedMs":620}
```

Logs contain metadata by default. For local prompt and tool payload inspection, also set
`CHAT_DEBUG_CONTENT=1`. This takes effect only with `NODE_ENV=development`. Payment prompt fields
and bank tool payloads are omitted, and sequences of six or more digits are masked. Other
conversation content can appear when content capture is enabled. Trace records stay on the server;
the browser still receives only normal chat events. Set `CHAT_DEBUG=0` to turn tracing off.

Core callers can pass `onTrace(event)` to `runChat` or `provider.streamChat` to collect diagnostic
events for tests or another log sink. Callbacks are synchronous; exceptions from them are ignored.
`createTrace({ requestId, write, captureContent? })` provides JSON formatting, timing and masking.
Custom callbacks receive content fields directly and should apply their own capture policy.

## Scripts

| Command          | What it does                                                                           |
| ---------------- | -------------------------------------------------------------------------------------- |
| `pnpm dev`       | Start the web app in dev mode                                                          |
| `pnpm build`     | Production build of the web app                                                        |
| `pnpm start`     | Serve the production build                                                             |
| `pnpm test`      | Unit and component tests (Vitest)                                                      |
| `pnpm test:e2e`  | e2e tests against the production build with the echo provider (run `pnpm build` first) |
| `pnpm typecheck` | Type-check every package                                                               |
| `pnpm format`    | Format with Prettier                                                                   |

## API

The conversation is kept on the server, in a **session**. The browser only stores the session id
(in `localStorage`) and sends the new message; history, User Info, pending bank details and the
summary live on the server (in memory for now: lost on restart, one server process only).

| Endpoint                     | Body                            | Response                                                              |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `POST /api/session`          | –                               | `201 { sessionId, messages: [], userInfo: {} }`                       |
| `GET /api/session?id=…`      | –                               | `{ sessionId, messages, userInfo, summary? }`; `404` when unknown     |
| `PUT /api/session/user-info` | `{ sessionId, userInfo }`       | `204`; only the parts sent are replaced                               |
| `POST /api/chat`             | `{ sessionId?, message }`       | NDJSON events (below)                                                 |
| `POST /api/payment-qr`       | multipart `sessionId` + `image` | `{ messages }` added to the chat; `400` / `422` `{ error, messages }` |

`POST /api/chat` responds `200` with NDJSON (`application/x-ndjson`), one event per line:

```
{"type":"session","sessionId":"…"}             always first (a new session when the id is missing or unknown)
{"type":"summary","count":6,"content":"..."}   when older messages were summarized
{"type":"text","text":"Dạ em ..."}              chunks of the assistant reply
{"type":"payment","payment":"Ngân hàng: ..."}   the user confirmed: User Payment was saved
```

Errors are `{ "error": "..." }` with:

- `400`: malformed body (the message must be 1–50,000 characters)
- `404`: unknown or expired session (`GET` / `PUT` / QR)
- `409`: a reply for this session is already in progress
- `500`: provider misconfigured (e.g. `OPENROUTER_API_KEY` not set)
- `502`: the provider failed before replying (invalid key, unknown model, rate limit, ...), or
  summarizing older messages failed

User Info parts are `profile`, `payment`, `purchaseHistory`, `commission` and `paymentHistory`
(strings, max 10,000 characters each); non-blank ones go into the system prompt as `## User Info ##`
sections. The UI edits them in **Settings → User Info**.

A session keeps the newest 1,000 messages / 150,000 characters and expires after 24 hours without
activity (at most 1,000 sessions). History sent to the model is kept within 4,000 estimated tokens
(`HISTORY_TOKEN_BUDGET` in `packages/core/src/chat/context.ts`): over that, the older messages are
summarized with the chat model (`SUMMARY_PROMPT`, one extra LLM call per request over budget) and
the summary goes into the system prompt under `## Conversation Summary ##`. The UI shows a
collapsible "Earlier conversation summarized" divider.

A failure after the reply has started aborts the stream; the partial reply is kept (on screen and
in the session).

### Bank info: confirm before saving

Bank info (User Payment) is never saved in the message where it first appears. The
`update_bank_info` tool has three steps:

- `propose`: the user typed new bank details; the bank must match the bank list. They become the
  session's **pending** details, nothing is saved, and the assistant reads them back.
- `confirm`: in a later message the user confirms; the pending details are saved exactly as read
  back (only the holder name may be added). A `payment` event updates the Settings panel.
- `cancel`: the user declines; the pending details are discarded.

The code enforces this: `confirm` only saves details that were pending when the request arrived,
and is refused after a `propose` or `cancel` in the same message.

The **QR** button is the other way to get pending details: `POST /api/payment-qr` reads the image
as a VietQR (checksum checked, image not stored), makes its details pending and adds
`[Ảnh mã QR ngân hàng]` plus the read-back to the chat. The user then confirms or declines as
above.

## Documents (RAG)

Put policy, FAQ and other reference files in `apps/web/knowledge/` as `.md` or `.txt` (convert
PDF/Word first). Markdown headings become searchable sections, so give each topic its own heading.
Changes are picked up on the next question, without a restart.

The server prepares document embeddings at startup and logs `[rag] Ready: ... document sections
indexed.` before accepting requests. The index is shared with chat requests and kept in memory;
restarting the server embeds the documents again. Changed documents trigger a rebuild on the next
search. If startup indexing fails, the error is logged and the next search retries.

When a question may be answered by these files, the model calls the `search_documents` tool; the
server embeds the query, returns the 4 most similar sections and the model answers from them.
Embeddings go through OpenRouter (`OPENROUTER_EMBEDDING_MODEL`), so search needs
`OPENROUTER_API_KEY` even with another chat provider. With no files in the folder, the tool is not
offered.

## Adding an LLM provider

1. Add the SDK to `packages/core` (`pnpm --filter @chatbot/core add <sdk>`).
2. Create `packages/core/src/providers/<name>.ts` implementing `ChatProvider`: yield text
   chunks from `streamChat` and pass `options.signal` to the SDK so aborted requests stop. To
   support document search, also handle `options.tools` (see `openrouter.ts`).
3. Register it in `packages/core/src/providers/index.ts`.
4. Set `CHAT_PROVIDER=<name>` (plus any API key it needs) in `apps/web/.env.local`.
