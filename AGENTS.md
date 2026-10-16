This is self-building chat app. The app is built with minimalist coding style so that engineer can read and self-customize.

Agent allow to modify and add feature, but do not over-thinking or write too much code without human approval.

Having [CODEMAP.md](CODEMAP.md) to guide through the source code.

## Where documents go

Use only these two folders for working documents. Do not create others (no `docs/`, no single-file notes).

```
feature/<feature-name>/      one folder per feature, kebab-case (e.g. feature/context-history/)
  spec.md                    what and why: behaviour, decisions, out of scope
  plan.md                    implementation steps
  progress.md                checklist of done / open milestones
bug_report/<bug-name>.md     one file per bug: symptom, root cause, fix
```

If a folder for the feature already exists, update it instead of creating a new one.

## When add feature or modify code

- Create `feature/<feature-name>/spec.md`, `plan.md` and `progress.md` before coding
- Update `progress.md` after finishing major milestone
- Update the spec/plan, if you change/add during your work
- Update [CODEMAP.md](CODEMAP.md)

## When fix a bug

- Inspect the bug first, write `bug_report/<bug-name>.md` with the root cause
- Apply TDD, create test first
- Fix and then update the bug report with the fix

## Important note

- This is self-control project, write minimal code, update spec/document when working on coding
- Several agents may work in this repo. Read a file before overwriting it, and never replace content you did not read (e.g. documents in `apps/web/knowledge/`)
