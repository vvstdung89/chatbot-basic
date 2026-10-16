# Plan: server-side system prompt

1. Test first: `packages/core/src/prompt.test.ts` for `withSystemPrompt`.
2. Add `SYSTEM_PROMPT` and `withSystemPrompt(messages, prompt = SYSTEM_PROMPT)` in
   `packages/core/src/prompt.ts`; export both from `src/index.ts`.
3. Call `withSystemPrompt(messages)` in `apps/web/src/app/api/chat/route.ts`, after validation and
   before the provider.
4. Update `README.md` and `CODEMAP.md`.
5. Run `pnpm test` and `pnpm typecheck`.
