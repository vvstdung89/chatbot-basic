# Spec: update User Payment from a bank QR image

## Goal

In the chat, the user uploads a picture of their bank QR (VietQR). The server reads the bank and
account from it, the assistant reads it back as a normal chat message and asks for confirmation,
and when the user confirms in their own words the **User Payment** part of User Info is updated.

No cards or special UI: the only new control is the composer button that opens the file picker.
Everything else is ordinary chat text.

## Flow

```
Composer [QR] ──▶ pick an image (PNG / JPEG / WebP, max 5 MB)
  ──▶ POST /api/payment-qr  (multipart form, field "image")
        sharp: auto-rotate, shrink to ≤ 1600 px, raw RGBA pixels
        jsqr: find the QR, get its text payload
        parseVietQR(payload): EMVCo fields + CRC check + local bank list
        ◀── 200 PaymentQrInfo { bin, bankCode?, bankShortName?, bankName?, accountNumber,
                                accountName?, type: 'account' | 'card' }
        ◀── 422 { error } no QR found / not a VietQR / CRC mismatch
        ◀── 400 { error } missing file, wrong type, too large
  ──▶ two chat messages are added (part of the history the model sees):
        user:      "[Ảnh mã QR ngân hàng]"
        assistant: paymentReadBack(info), a fixed template, e.g.
                   Dạ em đọc được từ mã QR:
                   - Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại thương Việt Nam)
                   - Số tài khoản: 0123456789
                   - Chủ tài khoản: NGUYEN VAN A      (or "chưa có trong mã QR")
                   Anh/chị xác nhận cập nhật thông tin thanh toán này không ạ?
                   (+ "Anh/chị cho em xin tên chủ tài khoản ạ." when the name is missing)
        On 422/400 the assistant message says the QR could not be read and why.
  ──▶ the browser keeps the read info as `pendingPayment` and sends it with each /api/chat
      request until it is confirmed, declined or replaced by a new upload
  ──▶ POST /api/chat with pendingPayment: the system prompt lists the pending details; when the
      user confirms, the model calls update_bank_info with source "qr" (see
      docs/feature/bank-info-tool/, which replaced the earlier classifier step)
  ──▶ "payment" event in the reply stream → User Payment (localStorage) replaced, pending cleared
```

User Payment text written on confirm (`formatPaymentInfo`):

```
Ngân hàng: <shortName> (<full name>)      ("BIN <bin>" when the bank is not in the list)
Số tài khoản: <account number>             ("Số thẻ" for card QRs)
Chủ tài khoản: <name>                      (left out when unknown)
```

## Rules

- QR reading is deterministic (decode + EMVCo parsing). Bank and account number shown and saved
  always come from the QR, never from LLM output; the model only decides when to save and may supply
  the account holder name the user typed.
- VietQR = tag 38 with GUID `A000000727`; bank BIN in 38›01›00, account/card number in 38›01›01,
  service code in 38›02 (`QRIBFTTA` account, `QRIBFTTC` card); name in tag 59 when present.
  Amount / note (tags 54, 62) are ignored. The CRC (tag 63, CRC-16/CCITT-FALSE) must match.
- A BIN missing from the bank list is still returned (bank name fields empty).
- `pendingPayment` from the browser is validated like other input (shape, lengths).
- The image is processed in memory and not stored or logged.

## Bank list

`packages/core/src/banks.json`: `bin`, `code`, `shortName`, `name` of each bank from
`https://api.vietqr.io/v2/banks` (75 banks, fetched 2026-10-16). Refresh by re-fetching and
keeping those four fields.

## Out of scope

- Updating a backend account (this app has none); only browser User Info changes.
- E-wallet QR codes (MoMo, ZaloPay) unless they are VietQR; showing the uploaded image in chat.
