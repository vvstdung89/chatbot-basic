# Progress: document search (RAG)

- [x] Retrieval method chosen by the owner: embedding search (`baai/bge-m3` via OpenRouter)
- [x] `ChatTool`, `ChatOptions.tools`, `Embedder` in `types.ts`
- [x] Tests first: `knowledge.test.ts`, tool loop + embedder in `openrouter.test.ts`, `getEmbedder`
- [x] `knowledge.ts`: chunking, in-memory index rebuilt on file change, `search_documents` tool
- [x] OpenRouter tool-call loop (max 5 rounds) and embedder; `getEmbedder(env)`
- [x] Wired into `POST /api/chat`; `apps/web/knowledge/` folder
- [x] `pnpm test`, `pnpm typecheck`, `pnpm build` pass
- [x] Live run against OpenRouter (DeepSeek V4.1 Flash + BGE-M3) with a temporary document holding
      made-up facts: the model called `search_documents` and answered with them; a greeting did
      not trigger a search. Temporary document removed.
- [x] Found in the live run: the model wrote blank lines alongside its tool call, so the reply began
      with empty lines. Test added (failed), then the provider trims leading whitespace of the
      reply.
- [x] `.env.example`, `README.md`, `CODEMAP.md` updated
- [x] Startup indexing added; implementation and verification tracked in
      `docs/feature/startup-embeddings/`.
- [ ] Owner adds the real policy / FAQ documents and checks answers in the browser
