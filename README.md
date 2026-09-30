# Dungeon Cortex

Dungeon Cortex is a single-player AI Dungeon Master web application using D&D 5e/SRD 2014 mechanics.

The core rule is simple: **backend code owns mechanical truth; AI narration only describes outcomes already resolved by deterministic code.**

## Project status

This repository is prepared for controlled development with Codex.

Use Codex for implementation, documentation updates, audits, and small validated refactors. Complex work should start with a truth check and a short plan before edits.

## Quick links

- Codex instructions: `AGENTS.md`
- Codex operator workflow: `docs/CODEX_WORKFLOW.md`
- Contribution workflow: `CONTRIBUTING.md`
- API overview: `docs/API.md`
- Rules-system decision: `docs/DECISION_5E_SRD_API.md`
- Architecture guide: `MASTER_ARCH_GUIDE.md`
- Product context: `PROJECT_CONTEXT.md`

## Quick start

### Requirements

- Node.js 20+
- pnpm
- PostgreSQL
- Git

### Install for a human local setup

Use a new development database. The migration and seed commands below write to the configured database.

CI uses Node.js 20, pnpm 9, and PostgreSQL 16 with pgvector. The migrations require the `vector` extension and create `pg_trgm`; make these available and ensure the database role can apply the migrations.

```bash
git clone https://github.com/Alvicious1981/dungeon-cortex.git
cd dungeon-cortex
pnpm install --frozen-lockfile
cp .env.example .env
```

Before continuing, edit `.env` in the repository root:

1. Set `DATABASE_URL` and `DIRECT_URL` to the same development database.
2. Set `PRIVATE_MODE_ENABLED=true` for the current private local mode.
3. Leave `OPENAI_API_KEY` empty to try mock narration, or configure a key for real narration.

Then apply the existing migrations and load the initial data:

```bash
pnpm generate
pnpm exec prisma migrate deploy
pnpm seed
pnpm exec tsx scripts/seed-conditions.ts
pnpm exec prisma migrate status
pnpm dev
```

`migrate deploy` applies the checked-in migrations. Use `migrate dev` only when deliberately developing schema changes against a disposable development database.

Check the seed summaries before proceeding. `pnpm seed` reads `data/srd-es/` and upserts `SrdSpell`, `SrdItem`, and `SrdMonster`; it does not populate `SrdEquipment` or `SrdCondition`. It can exit successfully despite failed upserts, so inspect `total`, `upserted`, `skipped`, and `failed`. The separate conditions script fetches the 2014 conditions from dnd5eapi and should report `Errors: 0`; it requires network access.

The instructions above are derived from the implementation and CI configuration. They were reviewed statically on 2026-09-30; a fresh local installation was not executed during that review.

The local app should open at:

```text
http://localhost:3000
```

### First campaign

1. Open the local app and select **Crear personaje**.
2. Fill **Nombre del personaje**, check **Linaje** and **Clase**, then select **Comenzar aventura**.
3. On the campaign page, enter `/roll 1d20` in **Tu acción** and select **Actuar**.
4. Check the command and roll result in **Bitácora de aventura**.
5. Visit `/campaigns` and select **Continuar campaña** to resume it.

This is the journey covered by `tests/e2e/critical-path.spec.ts`; reading the test does not establish that it passed on your installation. Without an OpenAI key, the narrator uses validated mock or fallback text. That does not establish that semantic memory works without the provider.

### Important note for Codex

Codex must not run migrations, seed scripts, dependency changes, or data-changing setup commands unless the active task explicitly authorizes them. For agent-driven work, ask Codex to explain why the command is needed before approving it.

## Environment variables

Copy `.env.example` to `.env` and fill the local values before running the app.

**For local development using the current single-user private mode:** after copying, set `PRIVATE_MODE_ENABLED=true`. With the safe default `false`, requests fail closed.

| Variable | Required in local dev | Required in production | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Yes | Main PostgreSQL connection string used by Prisma. |
| `DIRECT_URL` | Yes | Usually yes | Direct database connection used by Prisma workflows. |
| `PRIVATE_MODE_ENABLED` | Yes for current single-user private mode; set to true | No; safe default is `false` | Fail-closed gate. Set to literal `true` to enable single-user private mode (development only). This is not authentication and does not provide multi-user isolation. Never enable in public deployments. |
| `OPENAI_API_KEY` | Optional; app uses mock narration without it | Yes | Enables real AI DM narration and authenticated embedding requests. |
| `NEXT_PUBLIC_SUPABASE_URL` | No; transitional until real auth exists | No; inactive until real Supabase Auth wiring exists | Public Supabase project URL reserved for future auth wiring. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No; transitional until real auth exists | No; inactive until real Supabase Auth wiring exists | Public Supabase anon key reserved for future auth wiring. |

Never commit real `.env` values, API keys, database credentials, or production secrets.

## Validation commands

Run the smallest reliable validation command for the change being made.

```bash
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm build
```

Additional checks when relevant:

```bash
pnpm lint
pnpm test:e2e
pnpm check-retro
```

For the validation matrix by change type, see `CONTRIBUTING.md` and `AGENTS.md`. AGENTS recommends limiting local Vitest workers to two to avoid worker-startup timeouts.

Data-backed E2E tests require a disposable database whose name contains an `e2e` or `test` segment and `E2E_TEST_MODE=true`. Point both the application and tests at that database. For the verified project runbook, see the E2E section in `AGENTS.md`; it uses `pnpm build` followed by `pnpm start` and `PLAYWRIGHT_SKIP_WEBSERVER=1` to avoid development compilation timeouts.

## Troubleshooting

### `pnpm install` fails

Check that Node.js 20+ and pnpm are installed:

```bash
node --version
pnpm --version
```

### Database connection fails

Confirm that PostgreSQL is running and that `.env` contains valid local values:

```text
DATABASE_URL=
DIRECT_URL=
```

### Prisma client errors

Regenerate the Prisma client:

```bash
pnpm generate
```

Then retry the failing command.

### Migrations fail

Confirm the local database exists and that `DATABASE_URL` points to it. For agent-driven work, do not run migrations unless the active task explicitly authorizes database changes.

### Seed finishes but data is missing

Inspect the seed counters and any sampled errors. The main seed treats failed upserts as non-fatal; exit code zero alone does not prove the data loaded. Fix the reported issue and repeat the affected seed against the intended development database. Check the separate conditions seed as well.

### An action returns `ACTION_IN_FLIGHT`

Refresh campaign state and inspect the chronicle before retrying. A pending receipt means the outcome is uncertain; do not force another execution with a new request ID. See `docs/API.md` for retry semantics.

### Port 3000 is already in use

Stop the existing process or run the app on another port according to your local Next.js setup.

### Validation fails

Run the smallest relevant command first:

```bash
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm build
```

Report the failing command, the error summary, and the smallest proposed fix.

## Working with Codex

Recommended workflow:

1. Ask Codex to read `AGENTS.md` first.
2. Ask for a truth check before non-trivial implementation.
3. Require a short plan before multi-file or risky changes.
4. Approve small, validated changes only.
5. Ask Codex to report changed files, commands run, validation results, and remaining risk.

Codex-specific project files:

- `AGENTS.md` — main operating guide for Codex.
- `docs/CODEX_WORKFLOW.md` — step-by-step operator guide.
- `CONTRIBUTING.md` — contribution and validation workflow.
- `docs/API.md` — API and event-streaming overview.

## Documentation map

Read these documents in order when planning non-trivial work:

1. `docs/DECISION_5E_SRD_API.md` — rules-system authority and SRD data-source decision.
2. `MASTER_ARCH_GUIDE.md` — architecture and system law authority.
3. `PROJECT_CONTEXT.md` — product vision and scope authority.
4. `AGENTS.md` — Codex operating instructions.
5. `docs/architecture/SRD_DATA_LAYER.md` — SRD data-layer architecture.
6. `docs/API.md` — documented API routes and streaming contract.
7. `CONTRIBUTING.md` — contribution and validation workflow.

Historical documents under `docs/reference/` are retained for audit history only. They are not implementation authority unless explicitly rewritten for D&D 5e/SRD 2014 compatibility.

## Source of truth order

When documents conflict, use this order:

1. Explicit user instruction in the active task.
2. `docs/DECISION_5E_SRD_API.md` for rules-system and SRD data-source authority.
3. `MASTER_ARCH_GUIDE.md` for architecture and system law.
4. `PROJECT_CONTEXT.md` for product vision and scope.
5. Current implementation and tests.
6. Historical documents and archived references.

## Non-negotiable project rules

- D&D 5e/SRD 2014 is the only active rules baseline.
- `https://www.dnd5eapi.co/api` is the canonical external SRD data source.
- Backend code owns legality, rolls, DCs, HP, spell slots, conditions, persistence, and deterministic events.
- AI narration must not invent mechanics or mutate campaign-critical state.
- Do not reintroduce AD&D, OSR, retroclone mechanics, THAC0, descending Armor Class, AD&D saving throw categories, or gold-for-XP as active mechanics.
- Never claim completion without validation evidence.

## Legacy agent material

The `.agents/` directory is retained for compatibility with earlier Antigravity workflows. For Codex, prefer `AGENTS.md` and the current documentation map above.

`CLAUDE.md` is retained only for possible Claude Code usage and is not the primary operating file for Codex.
