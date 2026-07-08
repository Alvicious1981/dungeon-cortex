# Contributing to Dungeon Cortex

Thank you for contributing to Dungeon Cortex.

This project favors small, validated changes. This is especially important when work is performed by Codex or another coding agent.

## Before starting

Read these files in order:

1. `docs/DECISION_5E_SRD_API.md`
2. `MASTER_ARCH_GUIDE.md`
3. `PROJECT_CONTEXT.md`
4. `AGENTS.md`
5. The files directly related to the task

For base setup commands, see the README quick start. This document focuses on contribution workflow, validation expectations, and review standards.

## Source of truth order

When documents conflict, use this order:

1. Explicit user instruction in the active task.
2. `docs/DECISION_5E_SRD_API.md` for rules-system and SRD data-source authority.
3. `MASTER_ARCH_GUIDE.md` for architecture and system law.
4. `PROJECT_CONTEXT.md` for product vision and scope.
5. Current implementation and tests.
6. Historical documents and archived references.

## Local setup

See `README.md` for the complete local setup sequence and environment variable table.

For agent-driven work, migrations, seeds, dependency changes, and data-changing setup commands require explicit task approval.

## Validation

Run the smallest reliable validation command for the change.

```bash
pnpm typecheck
pnpm test
pnpm build
```

Additional checks when relevant:

```bash
pnpm lint
pnpm test:e2e
pnpm check-retro
```

## Validation by change type

| Change type | Minimum validation |
| --- | --- |
| Documentation only | Manual review; `pnpm check-retro` if rules terminology changed. |
| TypeScript types or shared contracts | `pnpm typecheck` |
| Rules/backend utilities | `pnpm test` |
| API routes or app-wide changes | `pnpm typecheck` and `pnpm build` |
| UI flow changes | `pnpm test:e2e` when feasible |
| D&D canon/rules terminology | `pnpm check-retro` |
| Dependency changes | `pnpm install`, relevant tests, and lockfile review |

## Pull request expectations

A good PR should include:

- a clear summary,
- why the change is needed,
- files changed,
- validation commands run,
- screenshots or notes for UI changes,
- remaining risk.

## Documentation rules

- Update documentation when behavior changes.
- Do not mark a feature complete unless code or validation proves it.
- Keep historical OSR/AD&D documents clearly marked as non-authoritative.
- Use D&D 5e/SRD 2014 terminology consistently.
- Do not duplicate long rules text when a source-of-truth document can be linked.

## Codex workflow

When using Codex:

1. Ask Codex to read `AGENTS.md`.
2. Ask for a truth check before implementation.
3. Approve small, validated changes only.
4. Require a final report with changed files, validation, and remaining risk.
5. Start a new Codex task when moving from planning to implementation or from implementation to QA.

## PR checklist

- [ ] I read the relevant source-of-truth documents.
- [ ] I inspected the real code before claiming implementation status.
- [ ] I updated docs if behavior changed.
- [ ] I ran the relevant validation command.
- [ ] I reported remaining risk.
- [ ] I did not introduce forbidden retro/OSR/AD&D mechanics.
