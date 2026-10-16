# Progress: prepare document embeddings at startup

- [x] Inspected the existing lazy index and Next.js startup hook.
- [x] Added four preparation lifecycle tests; confirmed they failed before implementation.
- [x] Added `prepare()`, the Node startup hook, and a shared index for chat requests.
- [x] Updated README, CODEMAP, and the original RAG spec/plan/progress.
- [x] All 49 tests pass; type checking and the production build pass.
- [x] Production startup logged `[rag] Ready: 9 document sections indexed.`; the page and
      `/api/chat` returned HTTP 200. A live FAQ query returned the illustrative 50,000 VND
      withdrawal minimum and explicitly identified it as sample data.
- [x] Verified reuse, concurrent preparation/search, document refresh, empty folders, and
      retry after failure with fake-embedder call counts. Browser interaction was not tested.
