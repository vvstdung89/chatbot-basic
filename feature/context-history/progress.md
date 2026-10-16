# Progress: history budget with a summary event

- [x] Owner chose: server re-summarizes every request, 4,000-token budget, collapsible divider
- [x] Tests first: `context.test.ts`, `withSummary` in `prompt.test.ts` (failed before code)
- [x] `context.ts` (`fitHistory`, `estimateTokens`, `createSummarizer`), `SUMMARY_PROMPT` and
      `withSummary` in `prompt.ts`
- [x] `route.ts`: fit history after choosing the provider, `X-Chat-Summary` header, 502 on failure
- [x] `Chat.tsx`: collapsible "Earlier conversation summarized" divider; styles in `globals.css`
- [x] `pnpm test` (57), `pnpm typecheck`, `pnpm build` pass
- [x] Live run against OpenRouter: an 11-message chat (≈4,023 tokens) whose name and order id
      appear only in the oldest messages. Header `count = 6`; the summary kept "Minh" and
      "QX-7781"; the reply answered both. A one-message chat sent no header. Reply took 14.5s
      (summary call + answer).
- [x] `README.md`, `CODEMAP.md` updated
- [ ] Owner checks the divider in the browser
