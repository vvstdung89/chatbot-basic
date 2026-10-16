# Plan: update User Payment from a bank QR image

1. Dependencies: `sharp` (already installed through Next.js; declare it) and `jsqr` in
   `@chatbot/core`; `qrcode` as a dev dependency to generate test images.
2. `packages/core/src/banks.json` from the VietQR bank list (four fields per bank).
3. Tests first:
   - `vietqr.test.ts`: payloads built in the test with CRCs computed independently (Python
     `binascii.crc_hqx`, recorded as literals): account QR, QR with name, card QR, unknown BIN, bad
     CRC, non-VietQR payload; `formatPaymentInfo`, `paymentReadBack`, `parsePendingPayment`.
   - `qr-image.test.ts`: PNG made with `qrcode` decodes to its payload; an image without a QR
     gives `null`.
   - `payment-confirm.test.ts`: `classifyPaymentReply` with a fake provider (JSON answer, JSON in
     a code fence, garbage → unclear); `withPaymentStatus` prompt sections.
4. `packages/core/src/vietqr.ts` (no Node imports, exported as `@chatbot/core/vietqr` for the UI):
   `PaymentQrInfo`, `parseVietQR`, `formatPaymentInfo`, `paymentReadBack`.
5. `packages/core/src/qr-image.ts` (server only): `decodeQrImage(buffer)` with sharp + jsqr.
6. `packages/core/src/payment-confirm.ts`: `classifyPaymentReply(provider, reply)`;
   `PAYMENT_CONFIRM_PROMPT` and `withPaymentStatus` in `prompt.ts`; `parsePendingPayment` in
   `validate.ts`.
7. `apps/web/src/app/api/payment-qr/route.ts`: validate the upload, decode, parse, JSON reply.
8. `route.ts` (chat): when `pendingPayment` is sent, classify the last user message, add the
   status to the system prompt, set `X-Payment-Update`.
9. `Chat.tsx`: QR button + hidden file input; add the two messages; keep `pendingPayment`; apply
   `X-Payment-Update` to `userInfo.payment`.
10. `README.md`, `CODEMAP.md`; `pnpm test`, `pnpm typecheck`, `pnpm build`; live run: upload a
    generated VietQR image, confirm in Vietnamese, check the header and the reply.

> Steps 6, 8 and 9 (classifier step, `X-Payment-Update` header) were later replaced by the
> `update_bank_info` tool and the NDJSON event stream: see `feature/bank-info-tool/`.
