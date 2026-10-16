# Spec: readable session log files

## Goal

Record each conversation session in its own file that a person can read top to bottom to see
what the user said, what the agent did step by step (history, summary, prompt, model rounds, tool
calls, document search, bank details) and what it answered. Replaces the JSON trace in the
terminal while it is on.

## Switch

- `CHAT_LOG_DIR=logs/sessions` (relative to `apps/web`) turns it on, **in development only**
  (`NODE_ENV=development`): the files hold full, unmasked conversation text, including account
  and phone numbers (owner's choice).
- While it is on, the terminal JSON trace (`CHAT_DEBUG`) is not printed; responses still carry
  `X-Request-Id`, and the same id is in the file.
- Off (unset, or not development): behaviour as today.
- `apps/web/logs/` is git-ignored.

## File

`<CHAT_LOG_DIR>/<sessionId>.md`, Markdown, one section appended per chat turn or QR upload:

```
# Session 6f1c2a…

Started 2026-10-17T09:12:03.120Z

## Turn · 2026-10-17 09:12:05 · request a68c119c

**User**

> đổi STK sang Techcombank 1903 1234 5678, tên Trần Thị Bình

| +ms  | Step |
| ---: | ---- |
| 0    | history: 1 message sent to the model |
| 1    | system prompt: 693 characters · tools: search_documents, update_bank_info · pending bank details: no |
| 2    | model round 0 (deepseek/deepseek-v4.1-flash): 2 messages, tools: search_documents, update_bank_info |
| 2280 | model round 0 done in 2278 ms: tool_calls, 1 tool call |
| 2281 | → update_bank_info (arguments not traced) |
| 2283 | ← update_bank_info: ok in 2 ms |
| 2284 | bank details proposed (pending, not saved): Techcombank · 190312345678 · TRAN THI BINH |
| 4100 | first text to the user |

<details><summary>System prompt</summary> … </details>

**Assistant**

> Dạ em đọc lại: …

Result: ✅ 200 in 5.2 s
```

- Steps come from the existing trace events, plus three from the session layer: the user message
  and whether the session is new, what happened to the bank details (proposed / saved /
  cancelled, with the details), and the summary text and reply.
- Search: the query and the files / headings / scores found, plus the tool result text.
- Errors: provider errors, the HTTP status and message; cancelled requests are marked.
- QR uploads: a "QR upload" section with the result and the two chat messages.
- The system prompt is the one the trace already exposes (User Payment shown as `[redacted]`,
  the Pending Bank Details section left out); bank details appear in the bank step instead.
- Requests that fail before a session is known (400, 409) are not written.
- Writing must never break a chat: failures are ignored.

## Out of scope

Log rotation or size limits, a log viewer, production logging.
