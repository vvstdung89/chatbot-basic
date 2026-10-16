# Progress

- [x] Inspect the flow and define the trace scope.
- [x] Add and run failing tests (missing trace module and callback events confirmed).
- [x] Implement core and HTTP tracing.
- [x] Update README, environment template and CODEMAP.
- [x] Verify 125 core unit/integration tests, 11 web route/component tests, and 8 production HTTP e2e tests.
- [x] Pass workspace type checks, production build, changed-file formatting and `git diff --check`.
- [x] Commit changes.

Validation uses fake providers/local HTTP fixtures and the echo provider; no live model response
is required. Production e2e confirms request IDs and unchanged chat NDJSON. Route tests cover
concurrent requests, content capture policy, disabled tracing, errors and cancellation.
