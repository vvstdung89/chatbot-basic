# Progress: `update_bank_info` tool

- [x] Owner asked for one tool to update bank info on text requests and after QR confirmation
      (replacing the classifier step)
- [x] Spec and plan written; `/api/chat` becomes an NDJSON event stream so tool results reach the
      browser even when text was streamed first
- [x] Tests first (`bank-tool.test.ts`, `findBank`, `withPendingPayment`): failed before code;
      classifier tests removed
- [x] `findBank`, `updateBankInfoTool`, `withPendingPayment`; `payment-confirm.ts`,
      `PAYMENT_CONFIRM_PROMPT`, `withPaymentStatus`, `PaymentStatus` removed. Also replaced raw
      combining characters in two `vietqr.ts` regexes with `\u0300-\u036f` escapes (same
      behaviour, readable source)
- [x] Event stream in `route.ts` (`ChatEvent` in `types.ts`), NDJSON reading in `Chat.tsx`;
      97 tests, typecheck, build pass
- [x] Live run against OpenRouter (NDJSON): QR confirm with "tên chủ tài khoản là Nguyễn Văn An"
      → `payment` event Vietcombank / 0123456789 / NGUYEN VAN AN (3.6s); typed "Techcombank số
      1903 1234 5678, tên Trần Thị Bình" → Techcombank / 190312345678 / TRAN THI BINH; decline,
      unknown bank "Zebra Bank" and a plain FAQ question → no `payment` event. In both saves the
      `payment` event came before the first text chunk
- [x] The model first repeated the name with diacritics ("TRẦN THỊ BÌNH") while TRAN THI BINH was
      saved; the tool description now asks to show the saved details exactly as returned, and the
      rerun matched
- [x] `README.md`, `CODEMAP.md`, `feature/payment-qr/` updated
- [x] Commit
- [ ] Owner checks the flow in the browser
