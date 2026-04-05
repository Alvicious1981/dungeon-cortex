# Rule: Protect State Integrity and Rules Validity

Dungeon Cortex is a rules-backed game system, not a freeform narrative toy.

## Mandatory constraints

- The AI may interpret player intent and narrate outcomes, but code must validate mechanics and state transitions.
- Canonical campaign state must be server-owned or otherwise authoritative and auditable.
- Combat, inventory, spell usage, HP, conditions, quests, and persistence must not be treated as presentation-only features.
- Do not implement UI placeholders that imply rules support unless the supporting logic exists or is clearly labeled as temporary scaffolding.
- Prefer deterministic calculations over opaque model-only decisions for gameplay-critical outcomes.

## Red flags

Pause and report risk if a proposed change would:

- move canonical rules enforcement into prompt text only;
- duplicate authoritative state across unsynchronized layers;
- hide unresolved state mutations behind narration;
- introduce fragile coupling between story generation and rules execution.
