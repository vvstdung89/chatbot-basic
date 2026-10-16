# Spec: refactor the chat pipeline before scaling

## Goal

Make adding a feature touch fewer files and put the untested logic under tests, without changing
behaviour. The last two features touched 11 and 8 source files; `route.ts`, `Chat.tsx`,
`prompt.ts` and `index.ts` changed every time, and the most complex logic (route orchestration,
NDJSON handling, the chat UI) had no tests.

## Changes

1. **Core grouped by feature**, one browser entry:

   ```
   packages/core/src/
     index.ts          server entry (everything browser-safe + server code)
     client.ts         browser entry: only code without Node / openai / sharp imports
     types.ts          shared types (ChatMessage, ChatTool, ChatProvider, ChatEvent, Embedder)
     chat/             run-chat.ts, validate.ts, context.ts, prompt.ts, user-info.ts, events.ts
     rag/              knowledge.ts
     payment/          vietqr.ts, banks.json, bank-tool.ts, qr-image.ts
     providers/        unchanged
   ```

   Package entry points: `@chatbot/core` (server), `@chatbot/core/client` (browser),
   `@chatbot/core/qr-image` (server, sharp; kept separate so other routes don't load sharp). The
   `user-info` and `vietqr` entry points are replaced by `client`. A test fails if anything
   reachable from `client.ts` imports `node:*`, `openai` or `sharp`.

2. **One prompt builder**: `buildSystemPrompt({ userInfo, summary, pendingPayment }, prompt?)`
   joins `SYSTEM_PROMPT` and an ordered list of sections (User Info, Conversation Summary, Pending
   Bank Details). Section texts are unchanged. Replaces the nested
   `withPendingPayment(withSummary(buildSystemPrompt(...)))`.

3. **Chat pipeline in core**: `parseChatRequest(body)` and
   `runChat(request, { provider, knowledge?, signal })` → `AsyncIterable<ChatEvent>`: fit the
   history (summary), build the prompt, wire the tools (`search_documents` when the knowledge base
   has files, `update_bank_info`), stream the reply and emit tool events before the next text.
   Nothing is yielded until the provider produced its first result, so failures before the reply
   still reject the first `next()` (the route answers 502). `encodeChatEvent` / `readChatEvents`
   (browser-safe) write and read the NDJSON lines. `route.ts` only does HTTP: parse (400),
   provider (500), first event (502), stream.

4. **Chat UI split**: `useUserInfo` (User Info state + localStorage), `useChat` (messages, send,
   QR upload, NDJSON events), and components `UserInfoSettings`, `Composer`, `Chat` (message
   list + composition). Rendering and texts unchanged.

## Bug fixes (see `docs/bug_report/`)

- `user-info-overwritten-during-stream.md`: edits made in Settings while a reply streams are lost
  when a `payment` event arrives.
- `unbounded-chat-request.md`: `/api/chat` accepts any number of messages of any length.

## Not changed

API (request body, NDJSON events, status codes), prompts, UI look, behaviour of tools. Login, rate
limits and server-side storage are separate work (they depend on who uses the app and where it
runs).
