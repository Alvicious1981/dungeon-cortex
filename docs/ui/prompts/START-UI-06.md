# START — UI-06: Spatial Inventory Presentation

**Operator:** paste everything below the line into a new Claude Code Desktop session (Local · Dungeon Cortex · worktree on ·
**Plan mode**). Guide: `docs/ui/README_OPERATOR.md`.

---

You are working on Dungeon Cortex (`Alvicious1981/dungeon-cortex`) in Claude Code Desktop, Local environment. Execute **only**
task **UI-06 — Spatial Inventory Presentation**. Do not start any other UI task.

## 1. Plan mode first — do not edit yet

1. Run the preflight in `docs/ui/UI-WORKFLOW.md` §5 (gate 1) and report repository, branch, HEAD, `origin/master`, working tree
   and divergence.
2. Prerequisite: UI-05 must already be in `origin/master`. Check `git log origin/master --oneline --grep "^UI-05:"`. No match and
   no deviation under "Maintainer decisions" → `STOP-PREREQ`. If a deviation is recorded, the prerequisite is the last task merged
   in that chosen order.
3. Read, in this order: `AGENTS.md`, `docs/DECISION_5E_SRD_API.md`, `MASTER_ARCH_GUIDE.md`, `PROJECT_CONTEXT.md`,
   `docs/UI_SPEC.md`, `docs/DESIGN.md`, `.claude/rules/ui-frontend.md`, `docs/ui/UI-WORKFLOW.md`, `docs/ui/tasks/UI-06.md`; then the
   code and tests that task file lists.
4. Report the real state, the files you expect to change, the risks, and a bounded plan that states this task's `UI_SPEC` tier.
   Do not edit anything until I approve the plan.

Task reminders: this is **P2** in `docs/UI_SPEC.md` §2 (P2.1) — say so in the plan; my approval of the plan confirms it should run
now. The inventory model has no position, size or capacity: if no real spatial data exists, build only the controlled
presentational contract with the existing list as fallback, and `STOP-AUTHORITY` rather than change the schema.

## 2. Authorization (this task and this session only)

`AGENTS.md` requires an explicit request before commits, branches or pull requests. For UI-06 you are authorized to:

- use the isolated non-master branch Desktop created from `origin/master`, or create `claude/ui-06-spatial-inventory`;
- edit files within the task's scope and run the validation commands in `docs/ui/UI-WORKFLOW.md` §6;
- **after verification passes:** `git add` explicit paths (never `git add .` or `git add -A`), `git commit`, push the task branch,
  and open one PR against `master` titled `UI-06: add spatial inventory presentation`, ready for human review.

You are **not** authorized to: merge, enable auto-merge, run `gh pr merge`, push to `master`/`main`, force-push, rebase,
`reset --hard`, `clean`; install, update or remove dependencies or change `pnpm-lock.yaml` (ask me first about `pnpm install` or
`pnpm generate` if the worktree needs setup); run migrations or seeds; touch `.env*`, secrets or deploy configuration; change
Prisma schema, API, SSE or persistence contracts, rules, combat, events or the AI layer; or start UI-07.

## 3. Stop rules

On any condition in `docs/ui/UI-WORKFLOW.md` §9 (for example `STOP-DIRTY`, `STOP-SCOPE`, `STOP-AUTHORITY`, `STOP-DEPENDENCY`,
`STOP-RETRY`, `STOP-MERGE`) stop, do not improvise, and answer with the template in `docs/ui/HANDOFF-EXTENDED.md`.

## 4. Finish

When verification passes and the PR is open, finish with `STOP — READY FOR HUMAN REVIEW`, the compact handoff from
`docs/ui/HANDOFF-COMPACT.md`, the PR URL, the working-tree state, and the line `NO MERGE PERFORMED`. Do not begin UI-07.

## Maintainer decisions

Operator: leave empty for the default sequence. Only this section, written by the maintainer, can record a deliberate deviation
(`docs/ui/UI-WORKFLOW.md` §3), for example "UI-06 is deferred". The agent never reorders by itself.

- (none)
