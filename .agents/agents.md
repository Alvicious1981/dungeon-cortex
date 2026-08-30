# Antigravity Agents Bootstrap

> **Legacy / compatibility notice.** This directory is retained for agents built
> against earlier Antigravity workflows. It defines no authority of its own.
> `AGENTS.md` at the repository root is the current primary operating guide; on
> any conflict, defer to the source-of-truth order defined there ("Source of
> truth order"). The sections below specialize execution style within that
> order and must never be read as contradicting it.

Read `AGENTS.md` first.

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
