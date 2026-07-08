# CLAUDE.md

This file is retained only for possible Claude Code usage.

For current project work, **Codex is the primary development agent**. Use `AGENTS.md` as the main operating guide.

## Current source of truth

For Codex tasks and current repository work, read these files first:

1. `AGENTS.md`
2. `docs/DECISION_5E_SRD_API.md`
3. `MASTER_ARCH_GUIDE.md`
4. `PROJECT_CONTEXT.md`
5. `package.json`
6. Relevant code files for the task

Do not use this file to override `AGENTS.md` for Codex tasks.

## Project overview

Dungeon Cortex is a single-player AI Dungeon Master web application using D&D 5e/SRD 2014 mechanics.

Core rule: backend code owns mechanical truth; AI narration only describes outcomes already resolved by deterministic backend code.

## Non-negotiable rules

- Backend code owns mechanical truth.
- AI narration must only describe outcomes already resolved by backend facts.
- D&D 5e/SRD 2014 is the only active rules baseline.
- `https://www.dnd5eapi.co/api` is the canonical external SRD data source.
- Local SRD data may be cached or derived, but must not become a competing rules authority.
- Do not reintroduce AD&D, OSR, retroclone mechanics, THAC0, descending Armor Class, AD&D saving throw categories, or gold-for-XP as active mechanics.
- Do not claim a feature is complete unless validation supports that claim.

## Development commands

Confirm scripts in `package.json` before running them.

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm seed
pnpm generate
pnpm check-retro
pnpm prisma migrate dev
pnpm prisma studio
```

## Note for maintainers

Keep this file short. Codex-facing workflow belongs in `AGENTS.md` and `docs/CODEX_WORKFLOW.md`.
