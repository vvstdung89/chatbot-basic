# Plan: prepare document embeddings at startup

1. Add tests for explicit preparation, index reuse, concurrent searches, and failed preparation.
2. Expose `KnowledgeBase.prepare()` using the existing index loader.
3. Share the knowledge instance between the startup hook and chat route; await preparation
   at Node server startup, logging success or failure.
4. Update README, RAG notes, and CODEMAP; run tests, type checking, build, and a runtime check.
