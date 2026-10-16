# Code map

Where things live and how a chat request moves through them. Update this file whenever you add,
move or rename code.

## Request flow

```
Chat.tsx ── POST /api/chat { messages, userInfo } ──▶ route.ts
                                             1. parseMessages(body),
                                                parseUserInfo(body)          validate.ts        → 400
                                             2. withSystemPrompt(messages,
                                                buildSystemPrompt(userInfo)) prompt.ts
                                             3. getProvider(process.env)     providers/index.ts → 500
                                             4. tools = [search_documents]
                                                if knowledge/ has files      knowledge.ts
                                             5. await first chunk of
                                                provider.streamChat(messages,
                                                { signal, tools })           providers/<name>   → 502
                                             6. stream the rest as text/plain (pull-based)
Chat.tsx ◀── text chunks ── appended to the last assistant message
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

| File                        | Contents                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/page.tsx`          | Home page: heading + `<Chat />`                                                                                                                                                                                                                                                                                                                             |
| `src/app/layout.tsx`        | Root HTML shell, page metadata, imports `globals.css`                                                                                                                                                                                                                                                                                                       |
| `src/app/globals.css`       | All styles: light/dark theme vars, `.page`, `.chat`, `.messages`, `.settings`, `.message` (+ `.user`, `.system`), `.error`, `.composer`                                                                                                                                                                                                                     |
| `src/app/api/chat/route.ts` | `POST` handler (flow above), using the shared `knowledge` from `src/lib/knowledge.ts`. `toTextStream` turns the provider iterator into a `ReadableStream`; `errorMessage` formats errors                                                                                                                                                                    |
| `src/instrumentation.ts`    | Node server startup hook: awaits `knowledge.prepare()`, logs the indexed section count or a retryable failure                                                                                                                                                                                                                                               |
| `src/lib/knowledge.ts`      | Process-wide `KnowledgeBase` shared by instrumentation and routes, using `getEmbedder(process.env)`                                                                                                                                                                                                                                                         |
| `knowledge/`                | Documents (`.md`, `.txt`) for `search_documents`; read from `process.cwd()/knowledge`                                                                                                                                                                                                                                                                       |
| `src/components/Chat.tsx`   | Client component. State: `messages`, `input`, `pending`, `error`, `userInfo`. Settings panel renders one User Info text box per `USER_INFO_SECTIONS` entry, saved to `localStorage` (`chatbot.userInfo`). `send` posts the full history plus `userInfo`, reads the streamed body into the last assistant message, keeps a partial reply if the stream fails |
| `next.config.ts`            | `transpilePackages: ['@chatbot/core']`                                                                                                                                                                                                                                                                                                                      |
| `tsconfig.json`             | Path alias `@/*` → `src/*`                                                                                                                                                                                                                                                                                                                                  |

## packages/core: provider-agnostic logic (`@chatbot/core`)

Ships TypeScript source; no build step. Entry points: `@chatbot/core` → `src/index.ts` (server), `@chatbot/core/user-info` → `src/user-info.ts` (browser-safe, used by the UI).

| File                          | Contents                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                | Public API; the server imports only from here                                                                                                                                                                                                                                               |
| `src/types.ts`                | `ChatRole`, `ChatMessage`, `ChatOptions` (`signal`, `tools`), `ChatProvider` (`name`, `streamChat(messages, options) → AsyncIterable<string>`), `ChatTool` (`name`, `description`, `parameters` JSON Schema, `run(args, signal)`), `Embedder`                                               |
| `src/validate.ts`             | `parseMessages(body)` and `parseUserInfo(body)` validate an untrusted `{ messages, userInfo? }` body; `ChatRequestError` carries a message safe to show the client                                                                                                                          |
| `src/user-info.ts`            | `USER_INFO_SECTIONS` (key + label of each User Info part), `UserInfo` type, `MAX_USER_INFO_LENGTH`. No Node imports                                                                                                                                                                         |
| `src/prompt.ts`               | `SYSTEM_PROMPT` (the guardrail text, edit it here); `buildSystemPrompt(userInfo)` appends non-blank User Info sections under `## User Info ##`; `withSystemPrompt(messages, prompt)` puts the prompt first and drops client `system` messages                                               |
| `src/knowledge.ts`            | `chunkDocument` (split by heading, then paragraphs ≤ 1,500 chars), `KnowledgeBase` (`files()`, `prepare()` to build the index ahead of searches, `search(query)`; in-memory index rebuilt when files change), `searchDocumentsTool(kb)` → the `search_documents` tool                       |
| `src/providers/index.ts`      | Provider registry (`Map` of name → factory from env), `getProvider(env)` picks by `CHAT_PROVIDER` (default `openrouter`), `getEmbedder(env)` (OpenRouter embeddings), `requireEnv`                                                                                                          |
| `src/providers/openrouter.ts` | `OpenRouterProvider`: `openai` SDK pointed at OpenRouter; yields `delta.content` only (reasoning is skipped); tool-call loop (`MAX_TOOL_ROUNDS`, `runTool` turns failures into error results). `createOpenRouterEmbedder`. `DEFAULT_OPENROUTER_MODEL`, `DEFAULT_OPENROUTER_EMBEDDING_MODEL` |
| `src/providers/echo.ts`       | `EchoProvider`: streams `You said: …` word by word with a delay; needs no API key; ignores tools                                                                                                                                                                                            |

## Tests (Vitest, `pnpm test`)

| File                                             | Covers                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/validate.test.ts`             | `parseMessages`, `parseUserInfo`                                                                                                  |
| `packages/core/src/prompt.test.ts`               | `withSystemPrompt`, `buildSystemPrompt`                                                                                           |
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

| To…                                                 | Edit                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Add an LLM provider                                 | New `packages/core/src/providers/<name>.ts`, register it in `providers/index.ts`     |
| Change the default model                            | `DEFAULT_OPENROUTER_MODEL` in `openrouter.ts`, plus `.env.example` and README        |
| Change the message shape or roles                   | `types.ts` and `validate.ts`                                                         |
| Change the guardrail prompt                         | `SYSTEM_PROMPT` in `packages/core/src/prompt.ts`                                     |
| Add or edit searchable documents                    | Files in `apps/web/knowledge/`                                                       |
| Change how documents are split, or how many results | `MAX_CHUNK_LENGTH` / `search({ limit })` in `knowledge.ts`                           |
| Add another tool                                    | Return a `ChatTool` (like `searchDocumentsTool`) and add it to `tools` in `route.ts` |
| Add or rename a User Info part                      | `USER_INFO_SECTIONS` in `packages/core/src/user-info.ts` (UI and prompt follow)      |
| Change status codes or streaming                    | `apps/web/src/app/api/chat/route.ts`                                                 |
| Change chat UI behaviour or look                    | `Chat.tsx`, `globals.css`                                                            |

Sample searchable content: `apps/web/knowledge/faq.md` contains a Vietnamese Siêu Hoàn FAQ (17
questions). Its figures are invented and not marked as samples, so the assistant states them as
policy: replace them with confirmed policies before real use.

Feature specs, plans and progress notes live in `feature/` (sample FAQ: `feature/sample-faq.md`).
Earlier feature notes live in `docs/features/<feature>/`.
