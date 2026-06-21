---
name: rules-audit
description: Verify AI layer contains no rules logic or state mutations — enforces the Code is Law architectural constraint
user-invocable: false
---

Before marking any task complete that touches `lib/ai/`, `app/api/`, or any new route handler, perform the following checks:

1. Grep `lib/ai/` for: `roll(`, `d20Check(`, `attackRoll(`, `damageRoll(`, `prisma.`, `.create(`, `.update(`, `.delete(`
2. Grep `app/api/` for direct imports from `lib/rules/` that perform rolls or validation outside the established intent→validate→mutate→narrate pipeline
3. Grep `lib/rules/` to confirm it contains no direct Prisma writes (state mutation must go through `lib/db/`)

If any violation is found:
- Flag it explicitly before claiming the task is complete
- Identify which file and line contains the violation
- Suggest the correct layer to move the logic to

The invariant: AI narrates outcomes. Rules resolve mechanics. DB owns state. These layers must never merge.
