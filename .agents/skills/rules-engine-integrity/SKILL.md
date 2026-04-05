# Rules Engine Integrity

Use this skill whenever a change affects combat, spells, inventory, HP, conditions, initiative, quest state, or any gameplay-critical mutation.

## Goal

Keep gameplay-critical outcomes deterministic, auditable, and separate from narrative embellishment.

## Checklist

- What is the authoritative state owner?
- Where is intent interpreted?
- Where is the rules check executed?
- Where is state mutated?
- Where is the result narrated/displayed?
- Can the player-visible output drift from authoritative state?

## Required design pattern

Prefer this flow:
1. Player intent captured
2. Intent normalized
3. Rules evaluated in code
4. State mutation applied to canonical state
5. UI/state events emitted
6. Narrative generated from verified outcome

## Red flags

- AI text deciding success/failure directly
- duplicated state with no reconciliation
- UI optimistic updates for critical game state without rollback strategy
- unresolved edge cases around interrupted combat, reconnection, or save/load

## Output

When this skill is used, include a short “state integrity check” section in the response.
