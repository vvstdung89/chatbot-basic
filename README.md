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
│           │   ├── api/chat/route.ts   POST /api/chat, streams the reply as text
│           │   ├── api/payment-qr/route.ts  POST /api/payment-qr, reads a bank QR image
│           │   ├── layout.tsx
│           │   ├── page.tsx
│           │   └── globals.css
│           └── components/Chat.tsx     Chat UI (client component)
├── packages/
│   └── core/                   Provider-agnostic chat logic (@chatbot/core)
│       └── src/
│           ├── types.ts                ChatMessage, ChatProvider, ChatTool, Embedder
│           ├── validate.ts             Request body validation
│           ├── prompt.ts               System prompt (edit it here) + User Info, summary prompt
│           ├── context.ts              History budget and summarizing older messages
│           ├── user-info.ts            User Info parts (browser-safe)
│           ├── vietqr.ts               Bank QR (VietQR) parsing and chat texts (browser-safe)
│           ├── banks.json              Bank list (BIN → name)
│           ├── qr-image.ts             Find the QR in an image (sharp + jsqr, server only)
│           ├── payment-confirm.ts      Classify the reply to a QR read-back
│           ├── knowledge.ts            Document search (chunking, embeddings, tool)
│           └── providers/
│               ├── index.ts            Provider registry (getProvider, getEmbedder)
│               ├── openrouter.ts       OpenRouter (default): chat with tool calls, embeddings
│               └── echo.ts             No-key development provider
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

| Variable                     | Default                        | Purpose                                        |
| ---------------------------- | ------------------------------ | ---------------------------------------------- |
| `CHAT_PROVIDER`              | `openrouter`                   | `openrouter`, or `echo` to run without a key   |
| `OPENROUTER_API_KEY`         | (required for `openrouter`)    | Key from https://openrouter.ai/keys            |
| `OPENROUTER_MODEL`           | `deepseek/deepseek-v4.1-flash` | Any model id from https://openrouter.ai/models |
| `OPENROUTER_EMBEDDING_MODEL` | `baai/bge-m3`                  | Embedding model for document search            |

To follow DeepSeek's newest Flash release automatically, set
`OPENROUTER_MODEL=~deepseek/deepseek-flash-latest` (an OpenRouter alias; the model can change
under you).

## Scripts

| Command          | What it does                    |
| ---------------- | ------------------------------- |
| `pnpm dev`       | Start the web app in dev mode   |
| `pnpm build`     | Production build of the web app |
| `pnpm start`     | Serve the production build      |
| `pnpm test`      | Run unit tests (Vitest)         |
| `pnpm typecheck` | Type-check every package        |
| `pnpm format`    | Format with Prettier            |

## API

`POST /api/chat`

```json
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "userInfo": { "profile": "Name: An", "purchaseHistory": "#123 shoes" }
}
```

Responds `200` with the assistant reply streamed as `text/plain`. Roles are `system`, `user` and
`assistant`. The server prepends the system prompt from `packages/core/src/prompt.ts` and drops client
`system` messages.

`userInfo` is optional. Its keys are `profile`, `payment`, `purchaseHistory`, `commission` and
`paymentHistory` (strings, max 10,000 characters each); non-blank ones are appended to the system
prompt as `## User Info ##` sections. The UI fills it from **Settings → User Info**, saved in the
browser. Errors are `{ "error": "..." }` with:

- `400`: malformed request body
- `500`: provider misconfigured (e.g. `OPENROUTER_API_KEY` not set)
- `502`: the provider failed before replying (invalid key, unknown model, rate limit, ...), or
  summarizing older messages failed

History is kept within 4,000 estimated tokens (`HISTORY_TOKEN_BUDGET` in
`packages/core/src/context.ts`). Over that, the server keeps the newest messages (about half the
budget), summarizes the older ones with the chat model (`SUMMARY_PROMPT`) and puts the summary in
the system prompt under `## Conversation Summary ##`. This happens on every request over budget,
so those replies take one extra LLM call. The response header `X-Chat-Summary` is
`encodeURIComponent(JSON.stringify({ count, content }))`: the first `count` sent messages were
replaced by `content`. The UI keeps showing all messages and adds a collapsible "Earlier
conversation summarized" divider.

A failure after the reply has started aborts the stream; the UI keeps the partial reply.

### Bank QR → User Payment

`POST /api/payment-qr` takes multipart form data with an `image` file (PNG, JPEG or WebP, max
5 MB), finds the QR code and reads it as a VietQR. It responds `200` with
`{ bin, bankCode?, bankShortName?, bankName?, accountNumber, accountName?, type }`, `400` for a bad
upload, or `422` when there is no readable bank QR (no QR, not VietQR, checksum mismatch). The
image is not stored.

In the chat, the **QR** button uploads an image; the chat then shows `[Ảnh mã QR ngân hàng]` and
the assistant reads the details back and asks for confirmation (plain chat text). The browser
sends those details as `pendingPayment` with the following messages; the server classifies each
reply with one extra LLM call (`PAYMENT_CONFIRM_PROMPT`). On confirm or decline the response
header `X-Payment-Update` is `encodeURIComponent(JSON.stringify({ status, payment? }))` and the
browser replaces User Payment (confirm) or drops the pending details (decline). Bank and account
always come from the QR; only the account holder name may come from the user's reply.

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
