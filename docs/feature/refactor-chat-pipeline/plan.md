# Plan: refactor the chat pipeline before scaling

Each step keeps all tests passing; behaviour changes only in the two bug fixes.

1. Bug reports with root causes (`docs/bug_report/`).
2. Folder structure: `git mv` core files into `chat/`, `rag/`, `payment/`; fix imports; add
   `client.ts` and the `./client` entry; switch the web app to it; add the client import guard
   test.
3. Prompt builder: rewrite `prompt.test.ts` for `buildSystemPrompt({ ... })` (fails), then
   implement; update callers.
4. Chat pipeline: tests first (`run-chat.test.ts`, `events.test.ts`, `parseChatRequest`), then
   `run-chat.ts`, `events.ts`; slim `route.ts`.
5. Bug `unbounded-chat-request`: tests first in `validate.test.ts`, then limits in
   `parseMessages`.
6. Web tests: Vitest + jsdom + Testing Library in `apps/web`. Bug
   `user-info-overwritten-during-stream`: a `Chat` test that reproduces it on the current code
   (fails), then split the UI (`useUserInfo`, `useChat`, components) with the fix.
7. `CODEMAP.md`, `README.md` (structure), progress; `pnpm test`, `pnpm typecheck`, `pnpm build`;
   live run of chat, RAG, QR upload and bank tool; commit.
