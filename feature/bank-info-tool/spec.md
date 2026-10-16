# Spec: `update_bank_info` tool

## Goal

One tool the chat model calls to save the user's bank info (User Payment in the browser's User
Info), in two cases:

1. The user confirms bank details read from their QR code (replaces the classifier step of
   `feature/payment-qr/`).
2. The user asks in text to set or change their bank account ("đổi STK sang Techcombank
   19031234567, tên Nguyễn Văn B").

## Tool

`update_bank_info({ source, bank?, accountNumber?, accountName? })`

| `source` | Bank and account come from                                                        | Required args                                    |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `"qr"`   | the pending QR details the browser sends (`pendingPayment`); never from the model | none (`accountName` optional)                    |
| `"text"` | the model's arguments, taken from the user's message                              | `bank`, `accountNumber` (`accountName` optional) |

- `bank` is matched against `banks.json` by code, short name, full name or BIN, ignoring case,
  diacritics, spaces and punctuation ("vcb", "Vietcombank", "970436"). No match → error result
  asking the model to check the bank with the user; nothing is saved.
- `accountNumber`: 1–32 letters or digits after removing spaces and dashes; otherwise an error
  result.
- `accountName` is written like banks print it (upper case, no diacritics).
- On success the tool returns the saved User Payment text to the model and emits a `payment`
  event; the browser replaces User Payment and clears `pendingPayment`.
- `source: "qr"` without pending details → error result.
- The tool description tells the model to call it only on the user's clear request or
  confirmation, and to tell the user the saved details afterwards.
- Pending QR details are described to the model in a system prompt section, "Pending Bank
  Details": confirm → call with `source: "qr"`; decline → don't save and don't ask again. They
  stay pending until saved or replaced by a new upload.

## `/api/chat` response becomes an event stream

Tools run while the reply streams, so the result cannot go in a response header. The response is
NDJSON (`application/x-ndjson`), one JSON object per line:

```
{"type":"summary","count":6,"content":"- Anh Minh ..."}     first, only when history was summarized
{"type":"text","text":"Dạ em đã cập nhật"}                   reply text chunks
{"type":"payment","payment":"Ngân hàng: ...\nSố tài khoản: ..."}   when update_bank_info saved
```

Events from tools are sent before the next text chunk, in the order they happened. The
`X-Chat-Summary` and `X-Payment-Update` headers are removed; errors before the reply stay JSON
`{ error }` with 400 / 500 / 502.

## Removed

The classifier step (`payment-confirm.ts`, `PAYMENT_CONFIRM_PROMPT`, `withPaymentStatus`): the
model now decides through the tool. No extra LLM call per message while details are pending.

## Out of scope

- Updating a backend account; only browser User Info changes.
- Updating other User Info parts through tools.
