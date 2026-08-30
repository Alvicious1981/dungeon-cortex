# Narrative Promptfoo Fixture Harness

This directory contains a deterministic, offline assertion harness for Dungeon Cortex narrative safety. It checks known-safe and known-unsafe output fixtures for:

- invented mechanical values, rewards, death, and conditions;
- direct and stored prompt-disclosure language;
- combined-context and delimiter leakage;
- unavailable mutation-tool names and tool-call syntax;
- oversized output; and
- English and Spanish number-word evasions.

## What it proves

Each blocked fixture declares `expectedFailureCodes`. A negative case passes only when the local assertion reports the intended category, so an unrelated regex match cannot hide a missing defense. Safe controls must produce no local failures.

The local provider validates the fixture shape and returns `mockOutput`, or a bounded `repeatOutput` used for the size case. It uses no API key, model, network request, production prompt builder, or production validator.

Production behavior is covered by `tests/security/prompt-injection.test.ts` and the focused narrative and memory Vitest suites. Run both layers when prompt security changes.

## Run

```bash
pnpm run eval:narrative
```

View saved results:

```bash
pnpm run eval:narrative:view
```

## Limitations

This harness does **not** measure whether a live model follows the production system prompt, resists adaptive attacks, avoids tool calls, or leaks context. Its assertion intentionally overlaps the production validator but is an independent JavaScript implementation, so the production Vitest corpus is the drift check.

It also does not cover homoglyphs, zero-width characters, every language, multi-turn attacks, retrieved external content, tokenizer-specific context limits, or provider-specific tool behavior.

Any live-model evaluation requires a separate approved task covering provider choice, secrets, cost, data handling, reproducibility, pass criteria, and rollback. Do not add credentials or live-provider configuration to this local suite.
