# Bug: `/api/chat` accepts unbounded messages

## Symptom

`POST /api/chat` accepts any number of messages of any length. A single request can make the
server parse a huge body and send a huge message to the model (cost, memory, latency).

## Root cause

`parseMessages` (`packages/core/src/validate.ts`) only checks that `messages` is a non-empty array
of `{ role, content }` strings. `fitHistory` limits what is summarized, but always keeps the latest
message whatever its size, and the whole body is still accepted and parsed. The browser sends the
full history on every request, so the request grows without limit over a long chat.

## Fix

- Tests first (`packages/core/src/chat/validate.test.ts` › "request limits", "trimHistory").
- `parseMessages` rejects (400) more than `MAX_MESSAGES` (1,000) messages, a message longer than
  `MAX_MESSAGE_LENGTH` (50,000 characters), or more than `MAX_HISTORY_LENGTH` (150,000
  characters) in total.
- A limit alone would break long chats, because the browser sends the whole history. So the
  browser now sends only `trimHistory(history)`: the newest messages within the limits. This does
  not change what the model sees: the server reads at most ~26k tokens (~80k characters) of
  history (kept messages + summarizer input). The summary divider adds the number of dropped
  messages to the event's `count` (`Chat.test.tsx` covers both).
- The message input has `maxLength={MAX_MESSAGE_LENGTH}`.
- Not covered: the raw body size before JSON parsing (a request body limit belongs with the
  login / rate limit work).
