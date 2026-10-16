# Plan: history budget with a summary event

1. Tests first: `packages/core/src/context.test.ts` (`estimateTokens`, `fitHistory`,
   `createSummarizer`) and `withSummary` in `prompt.test.ts`.
2. `packages/core/src/context.ts`: `HISTORY_TOKEN_BUDGET`, `estimateTokens`,
   `fitHistory(messages, { summarize, budget })` → `{ messages, summary? }`,
   `createSummarizer(provider, signal)`.
3. `packages/core/src/prompt.ts`: `SUMMARY_PROMPT` and `withSummary(prompt, summary)`.
4. `route.ts`: fit the history after choosing the provider, build the system prompt with the
   summary, send `X-Chat-Summary`; summarizer failure → 502.
5. `Chat.tsx`: read the header, render the collapsible divider; styles in `globals.css`.
6. Update `README.md` and `CODEMAP.md`; `pnpm test`, `pnpm typecheck`, `pnpm build`; a live run
   with a long conversation.
