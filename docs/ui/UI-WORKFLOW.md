# Dungeon Cortex — UI Workflow for Claude Code Desktop

Status: execution scaffolding for the UI-01 → UI-10 sequence.
Audience: Claude Code Desktop (Local) sessions and the maintainer who drives them.
Operator guide (Spanish): [README_OPERATOR.md](README_OPERATOR.md).

## 1. Status and purpose

This document says **in what order and through which gates** UI work is done. It does not define product scope,
visual design, game rules, architecture or repository safety. Those live elsewhere (§2) and always win.

`docs/ui/*` never:

- overrides `AGENTS.md`, `docs/DECISION_5E_SRD_API.md`, `MASTER_ARCH_GUIDE.md` or `PROJECT_CONTEXT.md`;
- replaces `docs/UI_SPEC.md` (product-level UI requirements) or `docs/DESIGN.md` (visual system);
- creates mechanical authority for any UI component;
- authorizes a merge, an auto-merge, a dependency change, a migration or a seed.

If a task file, a START prompt or this document contradicts a higher authority, the higher authority wins and the
session stops with `STOP-CONFLICT` (§9) instead of choosing silently.

## 2. Authority

Two axes, deliberately kept apart because the repository's own documents order them differently
(`AGENTS.md` lists the content authorities; `MASTER_ARCH_GUIDE.md` §1 lists `AGENTS.md` as the operating guide):

**How work is done** — editing limits, validation commands, approvals, Git, E2E safety, migrations: `AGENTS.md`.

**What is true** — highest first:

1. Explicit instruction from the maintainer in the active task (the pasted START prompt and chat).
2. `docs/DECISION_5E_SRD_API.md` — D&D 5e/SRD 2014 and SRD data-source authority.
3. `MASTER_ARCH_GUIDE.md` — architecture and system law (for UI: `COMBAT_CONSEQUENCE.payload.targets[]` is the truth of
   consequences; `ActionInput` owns the only campaign-action SSE fetch; combat quick controls expose only backend-resolved
   `Attack` and `End Turn`).
4. `PROJECT_CONTEXT.md` — product scope.
5. `docs/UI_SPEC.md` — product-level UI requirements and priorities.
6. `docs/DESIGN.md` and `app/globals.css` — visual system and tokens.
7. Current implementation and tests. If code and documentation disagree, report the mismatch before proposing changes.
8. `docs/ui/*` — this workflow, as execution scaffolding only.

A conflict between the two axes that cannot be resolved by reading both is `STOP-CONFLICT`.

## 3. Sequence and priority alignment

Default execution order, one task per Desktop session, no stacked UI PRs:

`UI-01 → UI-02 → UI-03 → UI-04 → UI-05 → UI-06 → UI-07 → UI-08 → UI-09 → UI-10`

A task starts from a version of `origin/master` that already contains the previous task. Check a prerequisite with
`git log origin/master --oneline --grep "^UI-0N:"` (squash merges keep the PR title as the subject). No match →
`STOP-PREREQ`, unless the baseline rule in §3.1 applies: PR #251 delivered part of this sequence under a different title.

The sequence is **not** the product priority. `docs/UI_SPEC.md` §2 is. Each task is anchored to it:

| Task | UI_SPEC anchor | Tier | Treatment |
| --- | --- | --- | --- |
| UI-01 Design normalization | `docs/DESIGN.md` §2, §5; `docs/UI_SPEC.md` §7 | cross-cutting hardening | tokens and shared primitives only |
| UI-02 Combat HUD | §2 P0.6; §3 Contexto | P0 | evolve the one HUD |
| UI-03 Action Bar | §2 P0.6; §3 Contexto | P0 (extends UI-02) | slots only for backend-resolved actions |
| UI-04 Character sheet | §2 P0.5; §3 Resumen | P0 | reorganize the one sheet |
| UI-05 Equipment ragdoll | §2 P1.1 (equipment as list view) | P1 enhancement | list stays the accessible primary view; only slots the domain defines |
| UI-06 Spatial inventory | §2 **P2.1** | P2 | presentational contract + list fallback; no schema change |
| UI-07 Contextual minimap | §2 **P2.2** | P2 | reuse the existing map and FOV; never leak undiscovered data |
| UI-08 Narrative panel | §2 **P0.4**; §3 Bitácora | P0 | evolve `StoryLog` and `ActionInput` |
| UI-09 Short Rest UI | not classified in `UI_SPEC` | unclassified | presents the existing rest authority only |
| UI-10 Long Rest UI | not classified in `UI_SPEC` | unclassified | presents the existing rest authority only |

The default order places two P2 tasks (UI-06, UI-07) before a P0 task (UI-08). This is reconciled without changing
product scope: the order stays as the maintainer prepared it, a P2 task states its tier in its plan, and **only the
maintainer — never the agent — may deviate**, by writing it under "Maintainer decisions" in the START prompt:

- **Defer** UI-06 and/or UI-07 (P2). The next task's prerequisite becomes the most recent task actually merged in the chosen order.
- **Run UI-08 immediately after UI-04.** UI-08 has no code dependency on UI-05 → UI-07; verify that in its plan. (Moot since
  PR #251: UI-08 is delivered, see §3.1.)

UI-09 and UI-10 have no tier in `UI_SPEC` §2. They are presentation of rest mechanics the backend already owns and add
no product scope; if the maintainer wants them classified, that is a `docs/UI_SPEC.md` decision, not a workflow edit.

### 3.1 Baseline after PR #251

PR #251 (`f923082`, "implement the UX/UI audit for the campaign screen") delivered much of this sequence **as one change
and under a title that does not start with `UI-0N:`**, so the `--grep` check in §3 cannot see it. Each task file now has a
"Baseline after PR #251" section with what exists, measured against `f923082` on 2026-10-01. Read it before the task's
objective: the objective text predates the merge.

| Task | After #251 | What remains |
| --- | --- | --- |
| UI-01 | **Residual** | palette classes and literals → `--dc-*` tokens; three unrendered surfaces to report, not touch |
| UI-02 | **Residual (small)** | player resources in the HUD; two open review items |
| UI-03 | **Residual, premise changed** | the action buttons now live in `MacroDeck`, not `CombatHUD`; the bar may no longer be wanted |
| UI-04 | **Residual** | the sheet reorganization itself; the "Equipo" section already exists |
| UI-05 | **Delivered by #251** | nothing, unless the backend exposes equip legality (a backend task first) |
| UI-06 | Untouched | unchanged; `InventoryGrid` gained a partial presentational contract |
| UI-07 | Untouched | unchanged; `MapSurface` and the map fixes exist |
| UI-08 | **Delivered by #251** | open follow-ups only (below) |
| UI-09 | Untouched | unchanged; rest results already render as text in the story log |
| UI-10 | Untouched | unchanged; same |

Rules:

- A task marked **Delivered by #251** counts as merged for prerequisite purposes once
  `git merge-base --is-ancestor f923082 origin/master` succeeds. Do not rebuild it.
- A task marked **Residual** is still to be run, scoped to the residual list in its task file and not to the original objective.
- Whether to run, trim or skip a residual task is the maintainer's decision, recorded under "Maintainer decisions" in the
  START prompt. The agent never closes a task on its own.
- A prerequisite that is a *residual* task is still a prerequisite: `UI-02` still waits for `UI-01` unless the maintainer defers it.

Open follow-ups from the review of #251 (none blocks; each is real and was left unfixed on purpose). Fixed in the same PR:
the dungeon map centering, "PV" → "PG", the repeated `aria-live` text, the unannounced loading state, the level-up
postponement and the E2E/unit tests that the merge broke.

- `StoryLog`: a persisted `system` row for the same action renders next to the live result card (ability and social checks).
- `StoryLog` / stream: live and persisted rows are matched by exact text; the root fix is a stable id carried from the stream
  to the persisted rows (a backend contract change, so a separate decision).
- `StoryLog`: live entries are never pruned; each render is O(entries × loaded logs).
- `CombatHUDController`: props overwrite the optimistic combat state mid-request (the `!isPending` guard was removed).
- `BattleGrid`: after a legal move the token snaps back to its origin until `router.refresh()` lands.
- `lib/hooks/useModalFocus.ts`: a `MutationObserver` on `document.body` re-runs the isolation pass on every DOM mutation.
- `ExplorationMap`: the accessible name of an adjacent room lost the room feature (treasure, hazard, NPC).
- `ConsequenceLog`: `ConsequenceEntry` has an unused `index` prop, and `components/combat/hit-points.ts` has no production caller.
- `lib/character-sheet/condition-labels.ts`: no test binds the label map to `CONDITION_REGISTRY`.
- `tests/components/CampaignChrome.test.tsx`: the `scrollIntoView` patch is not restored if an assertion fails early.

## 4. Desktop session model

- One UI task = one Desktop session = one worktree. Select Dungeon Cortex, enable the worktree option, start in
  **Plan mode**, paste the task's `docs/ui/prompts/START-UI-XX.md`.
- Move to **Accept edits** or **Manual** only after the plan is inside the task's scope. Never use **Bypass permissions**.
- If Desktop already gave the session an isolated non-master branch based on `origin/master`, use it. Otherwise create
  the branch named in the task file. Never work on `master`.
- Settings prompts for `git add`, `git commit`, `git push`, `pnpm exec` and PowerShell are expected. Approve a prompt only
  when the command is what the plan said it would run.

## 5. Gates

`PREFLIGHT → DISCOVER → PLAN → IMPLEMENT → TARGETED TESTS → GLOBAL VERIFY → DIFF REVIEW → COMMIT → PUSH/PR → STOP`

A failed gate blocks progression unless the failure is understood and repaired within scope.

1. **PREFLIGHT** — run and report:
   ```bash
   git remote -v
   git status --short --branch
   git branch --show-current
   git fetch origin --prune
   git rev-parse HEAD
   git rev-parse origin/master
   git log --oneline --decorate -10
   git diff --stat origin/master...HEAD
   ```
   Confirm the remote is `Alvicious1981/dungeon-cortex`, the branch is not `master`, the tree has no unrelated changes,
   HEAD relates to `origin/master` as expected, and the prerequisite is met. A new session re-runs this even if a handoff
   says it was already done. Git, not a handoff, is the authority.
2. **DISCOVER** — read the files listed in the task and START prompt, the callers and the tests. Identify existing
   components before creating any. For every value the UI shows, find what produces it; for every callback it fires,
   find what consumes it. A field only one side touches is the dormant-defect shape `AGENTS.md` documents.
3. **PLAN** — the smallest safe change. If it needs backend, schema, auth, AI-layer or rules changes, stop (§9).
4. **IMPLEMENT** — localized changes; preserve public contracts, keyboard access, accessibility and fallbacks.
5. **TARGETED TESTS** — smallest relevant set first (§6). A failing targeted test is explained before broader work.
6. **GLOBAL VERIFY** — §6.
7. **DIFF REVIEW** — `git status --short`, `git diff --check`, `git diff --stat`, `git diff`, plus the Desktop Diff panel.
   Confirm no unrelated files, generated content, lockfile change or secret.
8. **COMMIT / PUSH / PR** — only with the authorization block in the START prompt (§7) and only after verification.
9. **STOP** — return `STOP — READY FOR HUMAN REVIEW` with the compact handoff. Do not start the next task.

## 6. Validation commands

`AGENTS.md` is authoritative. Confirm a script exists in `package.json` before running it.

- **Targeted tests first:** `pnpm exec vitest run --maxWorkers=2 <test paths>`. **Not** plain `pnpm test`: on this machine
  it produces worker-startup timeouts that read as failures. A test that *times out* is usually contention — re-run that
  file alone. A test that fails an *assertion* is not contention.
- `vitest -t` treats a leading slash as a regex delimiter: `-t "/roll"` silently skips everything. Filter on a substring and
  read the count of tests run, not just the colour.
- **Regression tests must be able to fail.** For a test added to guard a behaviour, break the line it guards, confirm red,
  restore. A characterization test is green on the first run by construction, so this is the only way to know it guards anything.
- **Global:** `pnpm typecheck`; `pnpm lint` when relevant; the full suite `pnpm exec vitest run --maxWorkers=2` for broad
  changes; `pnpm build` for app-wide or framework-level UI changes.
- **E2E** only through the `AGENTS.md` runbook (disposable PostgreSQL, production build, `pnpm start`, `PLAYWRIGHT_SKIP_WEBSERVER=1`).
  A bare `pnpm test:e2e` or `pnpm test:e2e:smoke` is not a safe check here. Do not point a run at the real database.
- **Never** run a migration, `pnpm seed`, `prisma db …`, or touch `.env*`. `pnpm generate` (no database access) is allowed when
  types are missing. `pnpm install` for a fresh worktree is environment setup, not a dependency change: ask first, and a
  changed `pnpm-lock.yaml` is `STOP-DEPENDENCY`.
- Do not hide, skip, weaken or delete tests to manufacture a pass. Report skipped validation and why. Summarize
  successful output; keep detailed output only for diagnosis.

## 7. Git and delivery

`AGENTS.md` forbids commits, branches and pull requests unless the maintainer explicitly asks. The START prompt pasted for
a task **is** that explicit request, for that task and that session only. It does not carry to another task or session.
Without its authorization block: verify, report, stop.

With the block, a task may: commit using explicit paths (never `git add .` or `git add -A`), push its task branch, and
open or update one PR against `master`, ready for human review. Never:

- merge, run `gh pr merge`, or enable auto-merge (the repository has auto-merge off and `master` is not branch-protected,
  so this document and the START prompt are the guard);
- push to `master`/`main`, force-push, rebase, `reset --hard`, `clean`, or rewrite shared history;
- use bare `git stash` — the stash stack is shared across worktrees; use a temporary commit instead;
- delete or overwrite work that was not identified.

Integration is the maintainer's decision, after CI and human review. The repository squash-merges with a `(#NN)` suffix.

## 8. Common acceptance (all UI tasks)

In addition to the task's own acceptance:

1. Scope respected; no backend, Prisma/schema, auth, AI-layer or rules change; API, SSE and persistence contracts unchanged.
2. No new dependency, no lockfile change, no motion library.
3. The UI presents backend state. It does not compute AC, attunement, rest recovery, inventory legality, resource
   eligibility, FOV or combat results (`UI_SPEC` §8). `targets[]` stays the only consequence source.
4. Async surfaces cover the states in `UI_SPEC` §5: idle, loading, confirmed success, empty, recoverable error,
   unrecoverable error, degraded or lost connection, unavailable action with a visible reason. Important changes use text and,
   where fitting, an `aria-live` region.
5. Reference sizes 390×844, 768×1024, 1024×768, 1440×900 show no horizontal overflow (`UI_SPEC` §6).
6. Accessibility per `UI_SPEC` §7 and `.claude/rules/ui-frontend.md`: keyboard operation, visible `focus-visible`, 44×44 px
   targets, no colour-only state, `prefers-reduced-motion`, logical DOM order, one `h1` per screen.
7. Interface copy is Spanish (`UI_SPEC` §4); mechanical messages are direct; errors say what happened and what to do.
8. Existing shared primitives (`components/ui/Button.tsx`, `Panel.tsx`, `StatusMessage.tsx`) and `--dc-*` tokens are reused
   before anything parallel is created.
9. Validation in §6 passes or every failure is classified. The working-tree state is stated explicitly.

## 9. Stop rules

Never improvise through a Stop Rule. Stop, hand off, wait for the maintainer.

| Code | When |
| --- | --- |
| `STOP-REPO` | wrong or unverifiable repository or remote |
| `STOP-DIRTY` | unrelated local changes. Do not stash, reset, clean, overwrite or absorb them |
| `STOP-PREREQ` | the prerequisite task is not in `origin/master` (and no maintainer deviation is recorded) |
| `STOP-SCOPE` | a material change outside the task boundary, or a diff that is no longer reviewable in one PR |
| `STOP-AUTHORITY` | a required domain contract is missing or would have to be invented (schema field, route parameter, rule) |
| `STOP-DEPENDENCY` | a new dependency, or any lockfile change |
| `STOP-VERIFY` | a critical test or build failure that cannot be classified safely |
| `STOP-REGRESSION` | a regression that cannot be repaired within scope |
| `STOP-SECURITY` | secrets, `.env*`, production, a destructive operation or an unexpected privilege |
| `STOP-CONTEXT` | context degraded enough to threaten correctness |
| `STOP-RETRY` | two materially different repair attempts failed |
| `STOP-CONFLICT` | contradictory requirements, authorities or merge conflicts that need a human decision |
| `STOP-MERGE` | any merge or auto-merge step is requested or required |

## 10. Handoffs and context

- Successful task completion → [HANDOFF-COMPACT.md](HANDOFF-COMPACT.md).
- Any Stop Rule, failed verification, unresolved risk, or context transfer → [HANDOFF-EXTENDED.md](HANDOFF-EXTENDED.md).
- A new session re-runs the full preflight before editing and does not trust the handoff over Git.
- Never create a deliberately broken WIP commit to simplify a handoff.
- Use `/compact` when the current session is still the right worktree but context is filling. Move to a new session when the
  task has a valid Git checkpoint, context is degraded, a Stop Rule needs a decision, or the next work is another UI task.
  Uncommitted work lives only in its worktree: do not abandon that session unless the handoff says exactly how to recover it.
- No task starts the next task. No task merges.
- Optional read-only review after the PR is open: the maintainer may run `/dc-review-pr`; the review skills never edit.
