# Rule: Read Project Context First

Before architecture changes, multi-file edits, bug-fix plans, or implementation proposals, read `/PROJECT_CONTEXT.md`.

## Mandatory behavior

- Treat `/PROJECT_CONTEXT.md` as the canonical source of truth for this repository.
- Do not treat older TDDs, checklists, comments, or speculative design docs as authoritative if they conflict with `/PROJECT_CONTEXT.md`.
- If repository reality differs from `/PROJECT_CONTEXT.md`, report the mismatch explicitly instead of silently choosing one.
- Never claim a feature exists or works unless the codebase, tests, or runtime verification support that claim.

## Conflict resolution order

1. Current user instruction
2. `/PROJECT_CONTEXT.md`
3. `.agents/rules/*`
4. Relevant `.agents/skills/*`
5. Historical docs and notes
6. Agent preference
