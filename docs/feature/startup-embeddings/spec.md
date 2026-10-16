# Spec: prepare document embeddings at startup

- Prepare document embeddings when the Next.js Node server starts, before it accepts requests.
- Startup and chat requests share one in-memory `KnowledgeBase` per process.
- Searches reuse the prepared index; queries are still embedded separately.
- Keep automatic rebuilds when documents change, and share in-flight indexing work.
- Empty knowledge folders need no embedding request. Log startup failures and allow chat to
  start; document search retries a failed index build on its next call.
- No persistent storage: a new server process prepares its own index.

Startup uses the Next.js `instrumentation.ts` `register` hook:
https://nextjs.org/docs/app/guides/instrumentation
