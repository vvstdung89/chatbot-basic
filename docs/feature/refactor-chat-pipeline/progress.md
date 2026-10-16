# Progress: refactor the chat pipeline before scaling

- [x] Review done; owner approved the four refactors and the two bug fixes
- [x] Spec and plan written
- [x] Bug reports (root causes) in `docs/bug_report/`
- [x] Folder structure (`chat/`, `rag/`, `payment/`) via `git mv` with imports rewritten by
      resolving each one; `@chatbot/core/client` replaces the `user-info` / `vietqr` entries;
      guard test for client imports (and that it detects the server entry). 99 tests, build pass
- [x] Prompt builder: `buildSystemPrompt({ userInfo, summary, pendingPayment })` over an ordered
      section list; tests rewritten first (failed); `SYSTEM_PROMPT`, `SUMMARY_PROMPT` and section
      texts verified identical to before
- [x] Chat pipeline: tests first (`run-chat.test.ts`, `events.test.ts`, `parseChatRequest`), then
      `runChat`, `encodeChatEvent` / `readChatEvents` (plain `TextDecoder` with `stream: true`;
      `TextDecoderStream` did not type-check against core's `Uint8Array` streams) and
      `parseChatRequest`. `route.ts` 134 → 84 lines, HTTP only. 111 tests, typecheck, build pass
- [x] Bug `unbounded-chat-request`: tests first, then limits in `parseMessages` and `trimHistory`
      for the browser (so long chats keep working), input `maxLength`
- [x] Web tests (Vitest + jsdom + Testing Library). Bug `user-info-overwritten-during-stream`:
      `Chat.test.tsx` reproduced it on the old code (failed), then the UI split (`useUserInfo`,
      `useChat`, `UserInfoSettings`, `Composer`, `Chat`) fixed it; 3 more UI tests (sending,
      trimming + divider offset, QR flow). jsdom pinned to `^30.1.2`: 30.1.3 was released the day
      before and pnpm's release-age policy had added an exclusion for it; the exclusion was
      removed and the lockfile re-resolved
- [x] Owner moved working docs to `docs/feature/` and `docs/bug_report/`; `AGENTS.md`,
      `CODEMAP.md`, `README.md` and links inside the docs updated
- [x] `AGENTS.md` now asks for e2e tests: added `pnpm test:e2e` (`apps/web/e2e/`), which serves
      the production build with the echo provider and checks the page, NDJSON chat, 400 cases,
      QR upload (fixture image) and rejected uploads: 8 tests pass
- [x] Checks: 119 core + 4 web tests, 8 e2e tests, typecheck, build pass
- [x] Live run against OpenRouter after the refactor: QR confirm and typed bank update saved
      (`payment` event first), decline / unknown bank / FAQ question saved nothing; a long chat
      gave a `summary` event first (count 6) and the reply recalled "Minh" and "QX-7781"
- [x] `CODEMAP.md` and `README.md` updated; commit
- [ ] Owner checks the UI in the browser
