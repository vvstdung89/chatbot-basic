This is self-building chat app. The app is built with minimalist coding style so that engineer can read and self-customize.

Agent allow to modify and add feature, but do not over-thinking or write too much code without human approval.

Having [CODEMAP.md](CODEMAP.md) to guide through the source code.

## Where documents go

All working documents live under `docs/`, in these two folders only. Do not create other
document folders or single-file notes (e.g. no top-level `feature/` or `bug_report/`).

```
docs/
  feature/<feature-name>/      one folder per feature, kebab-case (e.g. docs/feature/context-history/)
    spec.md                    what and why: behaviour, decisions, out of scope
    plan.md                    implementation steps
    progress.md                checklist of done / open milestones
  bug_report/<bug-name>.md     one file per bug: symptom, root cause, fix
```

`CODEMAP.md`, `README.md` and `AGENTS.md` stay at the repository root.

If a folder for the feature already exists, update it instead of creating a new one.

## When add feature or modify code

- Create `docs/feature/<feature-name>/spec.md`, `plan.md` and `progress.md` before coding
- Update `progress.md` after finishing major milestone
- Update the spec/plan, if you change/add during your work
- Update [CODEMAP.md](CODEMAP.md)
- Apply TDD to test feature, with unitest, integraton test, e2e test

## When fix a bug

- Inspect the bug first, write `docs/bug_report/<bug-name>.md` with the root cause
- Apply TDD, create test first
- Fix and then update the bug report with the fix

## Version control

- When finish implementing, commit your current work.
- Prefer modify on current worktree, but If more than 2 agents working on the project, use another worktree to avoid confliction. The instruction for merge will be called later

## Important note

- This is self-control project, write minimal code, update spec/document when working on coding
- Several agents may work in this repo. Read a file before overwriting it, and never replace content you did not read (e.g. documents in `apps/web/knowledge/`)
