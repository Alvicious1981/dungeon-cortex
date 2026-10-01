# Skill governance — Dungeon Cortex

## Purpose

Dungeon Cortex uses repository-local skills in more than one host. The copies under `.agents/skills/` and `.claude/skills/` are intentional compatibility mirrors, not independent specifications.

## Rules

- `AGENTS.md` is the primary operating guide for current repository work.
- Paired skills under `.agents/skills/` and `.claude/skills/` must remain behaviorally equivalent.
- Host-specific path references may differ only when the referenced helper exists in one host.
- Architecture and product truth continue to come from the sources ordered in `AGENTS.md`; skill files are workflow instructions, not competing architecture authority.
- Do not remove `dc-implement-issue` or `dc-review-pr` merely because the external Dungeon Cortex Guardian plugin provides similar flows. The repository-local versions preserve Claude Code/Desktop portability.
- Persistence-related review is delegated to `dc-data-integrity-review`.
- `prisma-migrate` is a legacy compatibility name. Its current safe behavior is to prepare/review migration files and regenerate types; it must not apply migrations to the real database.
- No skill may weaken the repository prohibitions on automatic merge, force-push, destructive Git actions, production deployment, destructive database operations or secret propagation.

## Change process

When a paired skill changes:

1. update both host copies in the same PR;
2. compare their behavior, not only filenames;
3. review references to sibling skills/agents for valid paths;
4. state any intentional host-specific difference in the PR;
5. do not merge automatically.
