# Plan: `update_bank_info` tool

1. Tests first:
   - `vietqr.test.ts`: `findBank` (code, short name, full name without diacritics, BIN, unknown).
   - `bank-tool.test.ts`: `updateBankInfoTool` for `qr` (with / without pending, name override),
     `text` (valid, unknown bank, bad account number), `onUpdate` only on success.
   - `prompt.test.ts`: `withPendingPayment`.
2. `vietqr.ts`: `findBank(query)`. `bank-tool.ts`: `updateBankInfoTool({ pending, onUpdate })`.
3. `prompt.ts`: `withPendingPayment(prompt, pending)`; remove `PAYMENT_CONFIRM_PROMPT` and
   `withPaymentStatus`. Delete `payment-confirm.ts` and its tests; drop `PaymentStatus`.
4. `route.ts`: NDJSON event stream (`summary`, `text`, `payment`), tool events queued and flushed
   before the next text chunk; pass `update_bank_info` with the RAG tool.
5. `Chat.tsx`: read NDJSON lines; apply `summary` and `payment` events.
6. Update `docs/feature/payment-qr/` docs, `README.md` (API), `CODEMAP.md`.
7. `pnpm test`, `pnpm typecheck`, `pnpm build`; live run: QR confirm, text update, decline,
   unknown bank. Commit.
