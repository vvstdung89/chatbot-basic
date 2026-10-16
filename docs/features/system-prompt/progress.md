# Progress: server-side system prompt

- [x] Test for `withSystemPrompt` (failed first: module missing)
- [x] `withSystemPrompt` in `@chatbot/core`, exported
- [x] Wired into `POST /api/chat`
- [x] `.env.example`, `README.md`, `CODEMAP.md` updated
- [x] `pnpm test` and `pnpm typecheck` pass

## Change: prompt in source instead of env

- [x] Moved the prompt from `CHAT_SYSTEM_PROMPT` to `SYSTEM_PROMPT` in `packages/core/src/prompt.ts`
      (renamed from `system-prompt.ts`), with a default guardrail
- [x] Removed the env var from `.env.example` and `README.md`; `CODEMAP.md` updated
- [x] `pnpm test` and `pnpm typecheck` pass
