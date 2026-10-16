# Plan: User Info setting

1. Tests first: `parseUserInfo` in `validate.test.ts`, `buildSystemPrompt` in `prompt.test.ts`.
2. `packages/core/src/user-info.ts`: `USER_INFO_SECTIONS`, `UserInfo`, `MAX_USER_INFO_LENGTH`; no
   Node imports. Export it as `@chatbot/core/user-info` so the client component can import values.
3. `packages/core/src/validate.ts`: `parseUserInfo(body)` returns the known, valid parts.
4. `packages/core/src/prompt.ts`: `buildSystemPrompt(userInfo, prompt = SYSTEM_PROMPT)` appends the
   `## User Info ##` section with one `### Label ###` subsection per non-blank part.
5. `route.ts`: parse `userInfo`, then `withSystemPrompt(messages, buildSystemPrompt(userInfo))`.
6. `Chat.tsx`: Settings panel, one textarea per part, saved to `localStorage`, sent in the body.
   Styles in `globals.css`.
7. Update `README.md` (API) and `CODEMAP.md`. Run `pnpm test`, `pnpm typecheck`, `pnpm build`.
