# Plan

1. Add failing unit tests for trace formatting/privacy and pipeline callbacks, provider integration
   tests for model/tool ordering and errors, and an HTTP e2e check for request correlation.
2. Implement a small trace callback API and instrument the pipeline, provider and search tool.
3. Wire optional console JSON traces and request lifecycle events into the HTTP route.
4. Document configuration, update CODEMAP, run unit/integration/e2e tests and type checks, commit.
