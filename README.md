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

```bash
pnpm install
cp .env.example .env
pnpm generate
pnpm prisma migrate dev
pnpm seed
pnpm dev
```

The local app should open at:

```text
http://localhost:3000
```

### Important note for Codex

Codex must not run migrations, seed scripts, dependency changes, or data-changing setup commands unless the active task explicitly authorizes them. For agent-driven work, ask Codex to explain why the command is needed before approving it.

## Environment variables

Copy `.env.example` to `.env` and fill the local values before running the app.

| Variable | Required in local dev | Required in production | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Yes | Main PostgreSQL connection string used by Prisma. |
| `DIRECT_URL` | Yes | Usually yes | Direct database connection used by Prisma workflows. |
| `DEV_USER_ID` | Yes for local no-auth dev | No | Local development user fallback. |
| `OPENAI_API_KEY` | Optional; app uses mock narration without it | Yes | Enables real AI DM narration and authenticated embedding requests. |
| `NEXT_PUBLIC_SUPABASE_URL` | No; transitional until real auth exists | No; inactive until real Supabase Auth wiring exists | Public Supabase project URL reserved for future auth wiring. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No; transitional until real auth exists | No; inactive until real Supabase Auth wiring exists | Public Supabase anon key reserved for future auth wiring. |

Never commit real `.env` values, API keys, database credentials, or production secrets.

## Validation commands

Run the smallest reliable validation command for the change being made.

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

For the full validation matrix by change type, see `CONTRIBUTING.md`.

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
DEV_USER_ID=
```

### Prisma client errors

Regenerate the Prisma client:

```bash
pnpm generate
```

Then retry the failing command.

### Migrations fail

Confirm the local database exists and that `DATABASE_URL` points to it. For agent-driven work, do not run migrations unless the active task explicitly authorizes database changes.

### Port 3000 is already in use

Stop the existing process or run the app on another port according to your local Next.js setup.

### Validation fails

Run the smallest relevant command first:

```bash
pnpm typecheck
pnpm test
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
