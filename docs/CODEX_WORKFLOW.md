# Codex Workflow — Dungeon Cortex

This guide explains how to use Codex with Dungeon Cortex in a controlled and reviewable way.

## Goal

Use Codex for focused engineering tasks with clear scope, validation, and final reporting.

## Before starting

Prepare:

1. A clear task.
2. The allowed area of the repository.
3. The expected validation command.
4. Any files or folders that should stay unchanged.

## Recommended first prompt for Codex

```text
Read AGENTS.md, docs/DECISION_5E_SRD_API.md, MASTER_ARCH_GUIDE.md, PROJECT_CONTEXT.md, and package.json. Then inspect the relevant code and produce a truth check before proposing edits. Do not change files yet.
```

## Good task structure

A good Codex task should say:

1. What needs to change.
2. Why it needs to change.
3. Which area is allowed to change.
4. Which validation command must pass.

Example:

```text
Fix the combat consequence rendering bug. Stay within components/combat and lib/events unless you find a documented contract mismatch. Run pnpm typecheck and relevant tests before reporting completion.
```

## When to use a new Codex task

Start a new task when:

- the topic changes,
- the previous task became long,
- several attempts failed,
- you move from audit to implementation,
- you move from implementation to QA,
- you want an independent review.

## Review checklist

Before accepting changes, check that Codex reports:

- files changed,
- what changed,
- validation commands run,
- whether validation passed,
- remaining risk,
- any skipped validation and why.

## Validation commands

For TypeScript or shared contracts:

```bash
pnpm typecheck
```

For rules, backend, or utilities:

```bash
pnpm test
```

For broad app changes:

```bash
pnpm build
```

For UI or end-to-end flows:

```bash
pnpm test:e2e
```

For D&D rules-canon or terminology changes:

```bash
pnpm check-retro
```

## If validation fails

Ask Codex to report:

1. The command that failed.
2. The short error summary.
3. The likely cause.
4. The smallest next fix.
5. Whether a new task would be cleaner.

## Model selection

Use the most economical Codex model that can safely perform the task:

- Documentation updates: economical model is usually enough.
- Small UI fixes: economical or standard model is usually enough.
- Backend rules, migrations, combat, event contracts, or architecture: use the strongest available Codex model.
- Final QA after a large change: use the strongest available Codex model.

## Final report template

Ask Codex to finish each task with:

```text
Files changed:
- ...

What changed:
- ...

Validation run:
- ...

Result:
- Passed / Failed / Not run

Remaining risk:
- ...

Recommended next step:
- ...
```
