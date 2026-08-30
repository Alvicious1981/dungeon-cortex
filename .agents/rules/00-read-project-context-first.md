# Rule: Read Project Context First

> Legacy / compatibility rule under `.agents/`. It specializes procedure only
> and defines no authority of its own. `AGENTS.md` is the current primary
> operating guide; on any conflict, defer to its "Source of truth order".

Before architecture changes, multi-file edits, bug-fix plans, or implementation proposals, consult `PROJECT_CONTEXT.md` where useful, subordinate to the precedence order in `AGENTS.md`.

## Mandatory behavior

- Treat `PROJECT_CONTEXT.md` as useful product/scope context, never as canonical on its own — it ranks per the order defined in `AGENTS.md` ("Source of truth order").
- Do not treat older TDDs, checklists, comments, or speculative design docs as authoritative if they conflict with that order.
- If repository reality differs from documented canon, report the mismatch explicitly instead of silently choosing one.
- Never claim a feature exists or works unless the codebase, tests, or runtime verification support that claim.

## Conflict resolution

Defer to `AGENTS.md` → "Source of truth order". This file does not define an independent conflict order.
