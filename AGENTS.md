# AGENTS.md — Dungeon Cortex Codex Instructions

This is the primary operating guide for Codex in this repository.

## First read

Before planning non-trivial work, Codex must read:

1. `docs/DECISION_5E_SRD_API.md`
2. `MASTER_ARCH_GUIDE.md`
3. `PROJECT_CONTEXT.md`
4. `package.json`
5. The code files directly related to the task

Do not rely on historical milestone notes, old planning documents, or comments alone to determine current implementation truth.

## Source of truth order

When documents conflict, use this order:

1. Explicit user instruction in the active task.
2. `docs/DECISION_5E_SRD_API.md` for rules-system and SRD data-source authority.
3. `MASTER_ARCH_GUIDE.md` for architecture and system law.
4. `PROJECT_CONTEXT.md` for product vision and scope.
5. Current implementation and tests.
6. Historical documents and archived references.

If repository reality differs from documentation, report the mismatch before proposing changes.

## Project canon

- Dungeon Cortex uses D&D 5e/SRD 2014 only.
- `https://www.dnd5eapi.co/api` is the canonical external SRD data source.
- Backend code is authoritative for legality, rolls, DCs, damage, resources, conditions, state, persistence, and deterministic events.
- AI narration may only describe facts already resolved by backend code.
- Do not introduce AD&D, OSR, THAC0, descending Armor Class, AD&D saving throw categories, morale as an OSR authority system, or gold-for-XP as active mechanics.

## Editing rules

- Do not touch rules, combat, events, persistence, migrations, or action pipelines unless the task explicitly authorizes it.
- Do not modify `.env`, secrets, deployment configuration, or production credentials.
- Do not install, update, or remove dependencies unless the task explicitly authorizes it.
- Do not modify lockfiles unless dependency changes are explicitly authorized.
- Do not create commits, branches, tags, deployments, or pull requests unless the user explicitly asks.
- Keep changes small, reviewable, and tied to the requested task.

## Package manager

- Use the package manager detected in the repository.
- If `pnpm-lock.yaml` exists, use `pnpm`.
- Do not mix `npm`, `yarn`, `pnpm`, or `bun`.

## Safe validation commands

Before running a script, confirm it exists in `package.json`.

Use the smallest relevant check:

- `pnpm typecheck` — TypeScript and contract changes.
- `pnpm test` — rules, backend, utilities, and regression checks.
- `pnpm build` — broad app, route, or framework changes.
- `pnpm lint` — lint checks when relevant.
- `pnpm test:e2e` — UI flow or end-to-end behavior.
- `pnpm check-retro` — rules-canon or documentation changes involving D&D terminology.

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

## Commands requiring explicit approval

Ask before running commands that:

- remove files or folders,
- reset or clean Git state,
- install, update, or remove dependencies,
- run database migrations,
- run seed scripts that modify data,
- change deployment configuration,
- push to GitHub,
- deploy the app.

## Dormant defects

The defects that survived longest in this repository were not broken code. They were correct data read with the wrong shape, or values written and never read: inert until something started depending on them. Tests passed throughout, because nothing checked the result.

Three that reached `master` and were only found later:

- `lib/ai/intent.ts` classified `explore` and `travel`, and no gate in `app/api/campaign/[id]/action/route.ts` consumed either. Those actions crossed the route with nothing rolled and reached the narrator.
- `Combatant.stats` existed with a `{}` default and was never written. Every rule reading a creature's ability score silently saw 10.
- The encounter route read ability scores from `data.ability_scores`, a key the stored SRD JSON does not have. The flat `wisdom` and `dexterity` fields were right there, and the adjacent line already used them.

So, when inspecting:

- For every value produced, confirm something consumes it. For every value consumed, confirm something produces it. A field that only one side touches is the shape of this defect.
- Prefer a guard that binds both ends over a test that asserts one. `tests/architecture/intent-gate-exhaustiveness.test.ts` and `tests/api/action-intent-contract.test.ts` exist for that reason.
- Distrust a test that mocks the thing it appears to be testing. Mocking `@/lib/ai/intent` in a route test verifies the gates against hand-written intents and never exercises the classifier that feeds them.
- `vi.mock` of a module does not intercept calls that module makes to itself. Mocking `resolveAttackRoll` does not affect `lib/rules/combat.ts` calling it internally, so an assertion on the mock silently proves nothing.
- Before trusting a field, check the data. A read-only query against the real table settles in seconds what a type annotation only claims.

## Work style

For non-trivial tasks, Codex should:

1. Inspect the current implementation.
2. Summarize the real state.
3. Identify files likely to change.
4. Explain risks.
5. Propose the smallest safe plan.
6. Apply changes only within the requested scope.
7. Validate with relevant commands.
8. Report results clearly.

## Completion report

At the end of each task, Codex must report:

- files created or modified,
- what changed,
- commands executed,
- command results,
- remaining risks,
- whether prohibited files or operations were avoided,
- recommended next step.
