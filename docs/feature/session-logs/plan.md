# Plan: readable session log files

1. Tests first (core): `chat-turn.test.ts` — `turn.start` / `turn.end` trace events (message, new
   session, reply, summary, bank proposed / saved / cancelled); `chat/session-log.test.ts` —
   `createSessionLog` renders one turn per request from trace events (steps, search, errors,
   cancel, late events) and `renderQrUpload`.
2. `session/chat-turn.ts`: emit `turn.start` after the lock, `turn.end` in `finally`.
3. `chat/session-log.ts`: `createSessionLog({ requestId, write, now })` → `TraceCallback`;
   `renderQrUpload(...)`. Pure formatting; the caller writes files.
4. Web: `lib/session-log.ts` (`sessionLogDir()`, `appendSessionLog()` with the file header);
   chat route uses it instead of the terminal trace when on; QR route appends its section.
   Tests first in `route.test.ts` / `session/route.test.ts` (temp dir, development vs production,
   no terminal output).
5. `.gitignore`, `.env.example`, README (debugging section), CODEMAP; checks; a live run to look at
   a real file; commit.
