# Progress: update User Payment from a bank QR image

- [x] Owner decisions: update browser User Info; upload inside the chat; decode on the server;
      local bank list
- [x] Spec and plan written
- [x] Owner feedback: no confirm card or special UI; confirmation is plain chat text. Spec and
      plan revised (template read-back + LLM classification of the user's reply)
- [x] Owner chose the classifier step (not a tool) for confirming, and approved implementing
- [x] Dependencies (`sharp`, `jsqr`; dev `qrcode`) and `banks.json` (75 banks). The VietQR list
      stores 7 bank names in decomposed Unicode; normalized to NFC so text compares and displays
      consistently
- [x] Tests first (`vietqr.test.ts`, `qr-image.test.ts`, `payment-confirm.test.ts`, prompt and
      validate additions): failed before code
- [x] `vietqr.ts`, `qr-image.ts`, `payment-confirm.ts`, `withPaymentStatus`,
      `PAYMENT_CONFIRM_PROMPT`, `parsePendingPayment`: 92 tests pass. Card QRs are written as
      `Số thẻ: …` instead of a separate `Loại: thẻ` line (spec updated)
- [x] `POST /api/payment-qr` and the pending-payment step in `POST /api/chat`
- [x] Chat UI: QR button (file picker), read-back / failure messages as plain chat text,
      `pendingPayment` sent with messages, `X-Payment-Update` applied to User Payment
- [x] `pnpm test` (93), `pnpm typecheck`, `pnpm build` pass
- [x] Live run against OpenRouter with a generated Vietcombank VietQR PNG: upload → 200 with
      Vietcombank / 0123456789; text file → 400; fake PNG → 422. Replies to the read-back:
      "đúng rồi em, tên chủ tài khoản là Nguyễn Văn An" → confirmed, User Payment with
      `NGUYEN VAN AN` (2.2s); "rút tiền tối thiểu bao nhiêu vậy em?" → no header, answered from the
      FAQ and asked again (7.3s); "thôi khỏi, hủy đi em" → declined (2.5s)
- [x] `README.md`, `CODEMAP.md` updated
- [ ] Owner checks the flow in the browser with a real bank QR photo
- [x] Confirmation moved from the classifier step to the `update_bank_info` tool
      (`docs/feature/bank-info-tool/`); spec updated
