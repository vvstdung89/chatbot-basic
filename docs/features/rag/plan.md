# Plan: document search (RAG)

1. `types.ts`: `ChatTool` (`name`, `description`, `parameters` JSON Schema, `run(args, signal)`),
   `ChatOptions.tools`, and `Embedder` (`(texts, signal) => Promise<number[][]>`).
2. Tests first (`knowledge.test.ts`, `openrouter.test.ts`) with a fake embedder and the existing fake
   OpenRouter server.
3. `knowledge.ts`: `chunkDocument`, `KnowledgeBase` (`files()`, `search(query)`, in-memory index
   rebuilt when files change), `searchDocumentsTool(kb)`.
4. `providers/openrouter.ts`: tool-call loop in `streamChat` (collect streamed `tool_calls`, run the
   tools, send results, repeat; max 5 rounds) and `createOpenRouterEmbedder`.
5. `providers/index.ts`: `getEmbedder(env)` from `OPENROUTER_API_KEY` + `OPENROUTER_EMBEDDING_MODEL`.
6. `src/lib/knowledge.ts`: one shared `KnowledgeBase` for `apps/web/knowledge/`;
   `src/instrumentation.ts` awaits `prepare()` at Node server startup. `route.ts` reuses the index
   and passes `search_documents` when the folder has documents.
7. `apps/web/knowledge/` folder, `.env.example`, `README.md`, `CODEMAP.md`.
8. `pnpm test`, `pnpm typecheck`, `pnpm build`, then one real run against OpenRouter.
