# Chat tracing

Optional server-side JSON traces explain one chat request from validation through history
summarization, prompt preparation, model rounds, tools, retrieval and stream completion.
`CHAT_DEBUG=1` enables tracing and an `X-Request-Id` response header. Each record includes the
request ID and elapsed milliseconds. Debug records never enter the chat NDJSON stream.

Core entry points accept an optional `onTrace` callback. Callback failures must not change chat
behavior. Summary and answer model calls are distinguished. Tool error strings count as tool
failures even when the request succeeds. Completion, failure and cancellation are distinct.

Default logs contain metadata only. `CHAT_DEBUG_CONTENT=1` additionally includes prompts, tool
arguments/results and retrieval queries in development, with long account-number-like digit
sequences masked. Payment prompt sections and bank tool payloads are always omitted from traces.
Content capture is disabled in production. No credentials or request headers are recorded.

Out of scope: debug UI, persistent storage, external tracing services, automatic replay.
