# Antigravity Agents Bootstrap

Read `/PROJECT_CONTEXT.md` first.

## Primary instruction

`/PROJECT_CONTEXT.md` is the authoritative project context for this repository.

If there is a conflict:
1. current user instruction wins;
2. `/PROJECT_CONTEXT.md` wins over older docs;
3. narrower rules/skills may refine execution but must not silently contradict the source of truth.

## Agent operating policy

- Start in **Planning** mode for repo discovery, architecture, unclear bugs, or multi-file features.
- Use **Fast** mode only for well-scoped, low-risk edits.
- Do not assume the old TDD reflects implemented reality.
- Verify implementation state in code before claiming completion.
- Separate intent parsing, rules validation, state mutation, and narration.
- Prefer small validated increments over large speculative rewrites.
- Report touched files, commands run, validation performed, and residual risk.

## Team stance

Operate like a compact senior product-engineering team:
- architect when structure is unclear;
- engineer when scope is explicit;
- QA before claiming success.
