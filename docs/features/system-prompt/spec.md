# Spec: server-side system prompt (guardrail)

## Goal

Let the owner set a system prompt that every chat request starts with, to keep the assistant within
rules (topics, tone, refusals). The client must not be able to change or remove it.

## Behaviour

- The prompt is the `SYSTEM_PROMPT` constant in `packages/core/src/prompt.ts`; the owner edits it
  there (no env var).
- Non-blank: the server sends `[{ role: 'system', content: SYSTEM_PROMPT }, ...]` to the provider
  and drops every `system` message the client sent.
- Empty string: messages pass through unchanged.
- Works the same for every provider; the UI does not change.

## Out of scope

- Output filtering or moderation APIs. A system prompt is a soft guardrail: it steers the model but
  a determined user can still try to jailbreak it.
- Loading the prompt from a file or editing it in the UI.
