# Dungeon Cortex Antigravity Bootstrap

This package is designed to be copied into the root of a Google Antigravity workspace.

## Included

- `PROJECT_CONTEXT.md` — canonical project source of truth
- `.agents/agents.md` — Antigravity bootstrap instructions
- `.agents/rules/` — always-active operating constraints
- `.agents/skills/` — reusable task playbooks loaded on demand
- `.agents/workflows/` — optional slash-command workflows

## Install

1. Copy `PROJECT_CONTEXT.md` to the repository root.
2. Copy the full `.agents/` directory to the repository root.
3. Open the repo in Antigravity.
4. Start with a Planning-mode conversation.
5. Ask the agent to read `PROJECT_CONTEXT.md` and perform a repo truth report.

## Suggested first command

Use the workflow:

`/truthcheck`

Or prompt directly:

`Read PROJECT_CONTEXT.md, inspect the repository, and produce a concise repo truth report before proposing changes.`
