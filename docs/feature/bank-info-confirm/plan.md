# Plan: confirm before saving bank info (option B)

Built after `docs/feature/server-sessions/` steps 1–3 (store and `chatTurn` exist).

1. Tests first: rewrite `payment/bank-tool.test.ts` for `propose` / `confirm` / `cancel`
   (no save on propose, confirm needs earlier pending details, no confirm after propose in the
   same turn, errors); `run-chat.test.ts` events; prompt section wording.
2. `payment/bank-tool.ts`: steps, callbacks `onPropose`, `onConfirm`, `onCancel`.
3. `types.ts`: `pending_payment` event; `run-chat.ts`: wire callbacks to events;
   `chat/prompt.ts`: Pending Bank Details section for typed and QR details.
4. `session/chat-turn.ts`: apply `pending_payment` to the session, do not forward it.
5. `chat-turn.test.ts`: full flow over two turns (propose → confirm, propose → cancel, same-turn
   confirm refused).
6. Live run against OpenRouter: typed update → read-back → "đúng rồi" → saved; decline; QR →
   confirm. Docs, commit.
