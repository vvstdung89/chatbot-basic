# Progress: User Info setting

- [x] Tests for `parseUserInfo` and `buildSystemPrompt` (failed first)
- [x] First version: a single User Info text box
- [x] Changed to five parts (profile, payment, purchase history, commission, payment history)
      defined in `USER_INFO_SECTIONS`; tests rewritten first, then code
- [x] `POST /api/chat` reads `userInfo` and builds the system prompt from it
- [x] Settings panel in `Chat.tsx`, saved to `localStorage`
- [x] `README.md`, `CODEMAP.md` updated
- [x] `pnpm test`, `pnpm typecheck`, `pnpm build` pass; checked `POST /api/chat` with curl (echo
      provider): valid `userInfo` → 200, string `userInfo` → 400, non-string part → 400
- [ ] Owner check in the browser with the real model
