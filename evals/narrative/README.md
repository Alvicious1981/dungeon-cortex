# Narrative Promptfoo Evals

This folder contains a minimal Promptfoo evaluation for Dungeon Cortex narrative safety.

It evaluates simulated narration output against local safety checks: no invented mechanical numbers, no invented XP, no invented loot, no unconfirmed death, no unconfirmed conditions, and no forbidden legacy terminology.

This does not replace Vitest. The existing unit and integration tests remain the source for production behavior, while this eval gives a fast local harness for mocked narrative outputs.

The provider is local and simulated. It does not use API keys, does not call real models, and does not call external providers. It simply returns `vars.output` or `vars.mockOutput` for each test case.

Run the eval:

```bash
pnpm run eval:narrative
```

View saved results:

```bash
pnpm run eval:narrative:view
```

Future evaluations against real models must be added in a separate task with explicit scope, provider choice, secrets handling, tests, rollback, and risk review.