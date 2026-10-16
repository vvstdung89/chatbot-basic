# Code map

Where things live and how a chat request moves through them. Update this file whenever you add,
move or rename code.

## Request flow

```
Chat.tsx ── POST /api/chat { messages, userInfo, pendingPayment? } ──▶ route.ts
                                             1. parseMessages(body),
                                                parseUserInfo(body),
                                                parsePendingPayment(body)    validate.ts        → 400
                                             2. getProvider(process.env)     providers/index.ts → 500
                                             3. fitHistory(messages): over
                                                4,000 tokens → summarize
                                                older ones (extra LLM call)  context.ts         → 502
                                                if pendingPayment: classify
                                                the last user message
                                                (extra LLM call)             payment-confirm.ts
                                                withSystemPrompt(kept,
                                                withPaymentStatus(withSummary(
                                                buildSystemPrompt(userInfo),
                                                summary), payment))          prompt.ts
                                             4. tools = [search_documents]
                                                if knowledge/ has files      knowledge.ts
                                             5. await first chunk of
                                                provider.streamChat(messages,
                                                { signal, tools })           providers/<name>   → 502
                                             6. stream the rest as text/plain (pull-based),
                                                X-Chat-Summary header = { count, content },
                                                X-Payment-Update = confirmed | declined
Chat.tsx ◀── text chunks ── appended to the last assistant message;
             summary ── divider before message #count;
             confirmed ── userInfo.payment replaced, pendingPayment cleared
```

Bank QR upload (composer **QR** button):

```
Chat.tsx ── POST /api/payment-qr (multipart "image") ──▶ payment-qr/route.ts
                                             1. type PNG/JPEG/WebP, ≤ 5 MB             → 400
                                             2. decodeQrImage: sharp → jsqr  qr-image.ts → 422
                                             3. parseVietQR: EMVCo + CRC +
                                                banks.json                   vietqr.ts   → 422
Chat.tsx ◀── PaymentQrInfo ── chat gets user "[Ảnh mã QR ngân hàng]" + assistant
             paymentReadBack(info); info kept as pendingPayment for the next messages
```

Client disconnect aborts generation through `request.signal` → `ChatOptions.signal`.

At Node server startup, `src/instrumentation.ts` awaits `knowledge.prepare()` before requests
are accepted. `src/lib/knowledge.ts` keeps the instance on `globalThis` so the startup hook and
chat route reuse one in-memory index per process. Startup errors are logged; search retries.
Document changes trigger reindexing on the next search; a process restart prepares a fresh index.

Tool loop inside `OpenRouterProvider.streamChat` (step 5):

```
model streams text ───────▶ yielded to the client (leading blank lines dropped)
model streams tool_calls ─▶ runTool() ─▶ search_documents.run({ query })
                                         KnowledgeBase.search: embed query, cosine vs. sections
                         ◀─ tool result (top 4 "[file › heading] text") appended to history
repeat (max 5 rounds, then no tools offered) until the model answers with text only
```

## apps/web: Next.js app (`@chatbot/web`)

| File                              | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/page.tsx`                | Home page: heading + `<Chat />`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/app/layout.tsx`              | Root HTML shell, page metadata, imports `globals.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/app/globals.css`             | All styles: light/dark theme vars, `.page`, `.chat`, `.messages`, `.settings`, `.message` (+ `.user`, `.system`), `.error`, `.composer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/app/api/chat/route.ts`       | `POST` handler (flow above), using the shared `knowledge` from `src/lib/knowledge.ts`. `toTextStream` turns the provider iterator into a `ReadableStream`; `errorMessage` formats errors                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/app/api/payment-qr/route.ts` | `POST` bank QR upload (flow above): validates the file, `decodeQrImage`, `parseVietQR`; image kept in memory only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/instrumentation.ts`          | Node server startup hook: awaits `knowledge.prepare()`, logs the indexed section count or a retryable failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/lib/knowledge.ts`            | Process-wide `KnowledgeBase` shared by instrumentation and routes, using `getEmbedder(process.env)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `knowledge/`                      | Documents (`.md`, `.txt`) for `search_documents`; read from `process.cwd()/knowledge`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/components/Chat.tsx`         | Client component. State: `messages`, `input`, `pending`, `error`, `userInfo`, `summary`, `pendingPayment`. Settings panel renders one User Info text box per `USER_INFO_SECTIONS` entry, saved to `localStorage` (`chatbot.userInfo`). `send` posts the full history plus `userInfo` and `pendingPayment`, reads `X-Chat-Summary` into `summary` (collapsible divider before message `summary.count`) and `X-Payment-Update` into `userInfo.payment`, reads the streamed body into the last assistant message, keeps a partial reply if the stream fails. `uploadQr` posts the QR image and adds the read-back messages |
| `next.config.ts`                  | `transpilePackages: ['@chatbot/core']`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tsconfig.json`                   | Path alias `@/*` → `src/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## packages/core: provider-agnostic logic (`@chatbot/core`)

Ships TypeScript source; no build step. Entry points: `@chatbot/core` → `src/index.ts` (server), `@chatbot/core/user-info` → `src/user-info.ts` and `@chatbot/core/vietqr` → `src/vietqr.ts` (browser-safe, used by the UI), `@chatbot/core/qr-image` → `src/qr-image.ts` (server only, sharp).

| File                          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                | Public API; the server imports only from here                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/types.ts`                | `ChatRole`, `ChatMessage`, `ChatOptions` (`signal`, `tools`), `ChatProvider` (`name`, `streamChat(messages, options) → AsyncIterable<string>`), `ChatTool` (`name`, `description`, `parameters` JSON Schema, `run(args, signal)`), `Embedder`                                                                                                                                                                                                                                                   |
| `src/validate.ts`             | `parseMessages(body)`, `parseUserInfo(body)` and `parsePendingPayment(body)` validate an untrusted `{ messages, userInfo?, pendingPayment? }` body; `ChatRequestError` carries a message safe to show the client                                                                                                                                                                                                                                                                                |
| `src/user-info.ts`            | `USER_INFO_SECTIONS` (key + label of each User Info part), `UserInfo` type, `MAX_USER_INFO_LENGTH`. No Node imports                                                                                                                                                                                                                                                                                                                                                                             |
| `src/prompt.ts`               | `SYSTEM_PROMPT` (the guardrail text, edit it here); `buildSystemPrompt(userInfo)` appends non-blank User Info sections under `## User Info ##`; `SUMMARY_PROMPT` (summarizer instructions) and `withSummary(prompt, summary)` (`## Conversation Summary ##`); `PAYMENT_CONFIRM_PROMPT` (classifies the reply to a QR read-back) and `withPaymentStatus(prompt, status)` (`## Payment Update ##`); `withSystemPrompt(messages, prompt)` puts the prompt first and drops client `system` messages |
| `src/context.ts`              | History budget: `HISTORY_TOKEN_BUDGET` (4,000), `estimateTokens` (chars / 3), `fitHistory(messages, { summarize })` keeps the newest messages within half the budget (from a user message) and summarizes the rest into `{ count, content }`; `createSummarizer(provider)`                                                                                                                                                                                                                      |
| `src/vietqr.ts`               | Bank QR (VietQR/EMVCo): `parseVietQR(payload)` (CRC check, BIN/account from template GUID `A000000727`, name from tag 59, `banks.json` lookup), `PaymentQrError`, `normalizeAccountName`, chat texts `QR_UPLOAD_MESSAGE` / `paymentReadBack` / `paymentReadFailed`, `formatPaymentInfo` (User Payment text), `PaymentQrInfo`, `PaymentStatus`. No Node imports                                                                                                                                  |
| `src/banks.json`              | 75 banks (`bin`, `code`, `shortName`, `name`) from api.vietqr.io/v2/banks, names in NFC                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/qr-image.ts`             | `decodeQrImage(image)`: sharp (EXIF rotate, ≤ 1600 px, RGBA) + jsqr → QR text or null. Server only                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/payment-confirm.ts`      | `classifyPaymentReply(provider, pending, reply)` → confirm / decline / unclear (+ name), `resolvePendingPayment` → `PaymentStatus` (bank and account always from the QR)                                                                                                                                                                                                                                                                                                                        |
| `src/knowledge.ts`            | `chunkDocument` (split by heading, then paragraphs ≤ 1,500 chars), `KnowledgeBase` (`files()`, `prepare()` to build the index ahead of searches, `search(query)`; in-memory index rebuilt when files change), `searchDocumentsTool(kb)` → the `search_documents` tool                                                                                                                                                                                                                           |
| `src/providers/index.ts`      | Provider registry (`Map` of name → factory from env), `getProvider(env)` picks by `CHAT_PROVIDER` (default `openrouter`), `getEmbedder(env)` (OpenRouter embeddings), `requireEnv`                                                                                                                                                                                                                                                                                                              |
| `src/providers/openrouter.ts` | `OpenRouterProvider`: `openai` SDK pointed at OpenRouter; yields `delta.content` only (reasoning is skipped); tool-call loop (`MAX_TOOL_ROUNDS`, `runTool` turns failures into error results). `createOpenRouterEmbedder`. `DEFAULT_OPENROUTER_MODEL`, `DEFAULT_OPENROUTER_EMBEDDING_MODEL`                                                                                                                                                                                                     |
| `src/providers/echo.ts`       | `EchoProvider`: streams `You said: …` word by word with a delay; needs no API key; ignores tools                                                                                                                                                                                                                                                                                                                                                                                                |

## Tests (Vitest, `pnpm test`)

| File                                             | Covers                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/validate.test.ts`             | `parseMessages`, `parseUserInfo`, `parsePendingPayment`                                                                           |
| `packages/core/src/prompt.test.ts`               | `withSystemPrompt`, `buildSystemPrompt`, `withSummary`                                                                            |
| `packages/core/src/context.test.ts`              | `estimateTokens`, `fitHistory` (fake summarizer, small budgets), `createSummarizer`                                               |
| `packages/core/src/vietqr.test.ts`               | `parseVietQR` on payloads with independently computed CRCs, chat texts, `formatPaymentInfo`                                       |
| `packages/core/src/qr-image.test.ts`             | `decodeQrImage` on PNGs made with `qrcode`, a rotated JPEG photo, a blank image, non-image data                                   |
| `packages/core/src/payment-confirm.test.ts`      | `classifyPaymentReply`, `resolvePendingPayment` with a fake provider                                                              |
| `packages/core/src/knowledge.test.ts`            | `chunkDocument`, `KnowledgeBase` (preparation, reuse, concurrency, retry, empty folders, document changes), `searchDocumentsTool` |
| `packages/core/src/providers/providers.test.ts`  | `EchoProvider`, `getProvider` env handling, `getEmbedder`                                                                         |
| `packages/core/src/providers/openrouter.test.ts` | `OpenRouterProvider` (incl. tool loop) and `createOpenRouterEmbedder` against a local fake server (no network)                    |

`apps/web` has no tests yet.

## Config

| File                 | Contents                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `.env.example`       | Template for `apps/web/.env.local`: `CHAT_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_EMBEDDING_MODEL` |
| `package.json`       | Root scripts, delegating to the workspaces                                                                                  |
| `tsconfig.base.json` | Shared strict compiler options (incl. `noUncheckedIndexedAccess`)                                                           |

## Where to change things

| To…                                                 | Edit                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Add an LLM provider                                 | New `packages/core/src/providers/<name>.ts`, register it in `providers/index.ts`                                      |
| Change the default model                            | `DEFAULT_OPENROUTER_MODEL` in `openrouter.ts`, plus `.env.example` and README                                         |
| Change the message shape or roles                   | `types.ts` and `validate.ts`                                                                                          |
| Change the guardrail prompt                         | `SYSTEM_PROMPT` in `packages/core/src/prompt.ts`                                                                      |
| Change the history budget or summary style          | `HISTORY_TOKEN_BUDGET` in `context.ts`, `SUMMARY_PROMPT` in `prompt.ts`                                               |
| Change QR chat texts or reply classification        | `paymentReadBack` / `paymentReadFailed` in `vietqr.ts`, `PAYMENT_CONFIRM_PROMPT` in `prompt.ts`                       |
| Refresh the bank list                               | Re-fetch https://api.vietqr.io/v2/banks into `packages/core/src/banks.json` (`bin`, `code`, `shortName`, `name`, NFC) |
| Add or edit searchable documents                    | Files in `apps/web/knowledge/`                                                                                        |
| Change how documents are split, or how many results | `MAX_CHUNK_LENGTH` / `search({ limit })` in `knowledge.ts`                                                            |
| Add another tool                                    | Return a `ChatTool` (like `searchDocumentsTool`) and add it to `tools` in `route.ts`                                  |
| Add or rename a User Info part                      | `USER_INFO_SECTIONS` in `packages/core/src/user-info.ts` (UI and prompt follow)                                       |
| Change status codes or streaming                    | `apps/web/src/app/api/chat/route.ts`                                                                                  |
| Change chat UI behaviour or look                    | `Chat.tsx`, `globals.css`                                                                                             |

Sample searchable content: `apps/web/knowledge/faq.md` contains a Vietnamese Siêu Hoàn FAQ (17
questions). Its figures are invented and not marked as samples, so the assistant states them as
policy: replace them with confirmed policies before real use.

Feature specs, plans and progress notes live in `feature/<feature>/` (`spec.md`, `plan.md`,
`progress.md`); bug reports in `bug_report/<bug>.md`. See `AGENTS.md`.
