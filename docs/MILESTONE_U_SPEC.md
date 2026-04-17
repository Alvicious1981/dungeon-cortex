# Milestone U — The Weave & The Curse (Advanced Interaction Engine)

## 🎯 Goal
Transition magic and status effects from "Narrative Flavor" to **"Authoritative Law."** This milestone ensures that spell slots are consumed, saving throws are calculated deterministically, and conditions apply real mechanical penalties to combat resolution without AI hallucination.

## 🧱 Architectural Pillars
1. **Code is Law**: Spell slot consumption, DC-based saving throws, and condition penalties are calculated by the rules engine.
2. **State is Truth**: `Combatant.conditions` is the single source of truth for debuffs; the VTT must reflect this state visually.
3. **Deterministic Multi-targeting**: The Action API will support intentional targeting of multiple IDs for Area-of-Effect (AoE) and targeted spells.

---

## 🍰 Execution Slices

### Slice 1: The Condition Registry & Adv/Dis Authority
*   **Objective**: Make the rules engine aware of the mechanical impact of 5e conditions.
*   **Tasks**:
    1.  Create `lib/rules/conditions.ts` to define a registry of standard conditions (e.g., *Blinded, Prone, Paralyzed, Poisoned*).
    2.  Implement an `evaluateAdvantage(attacker, defender)` helper that checks the `conditions` Json field of both participants.
    3.  Update `resolveAttackRoll` in `lib/rules/combat.ts` to accept explicit `advantage` and `disadvantage` flags derived from the active registry.
*   **Verification**: Unit tests in `tests/rules/conditions.test.ts`.

### Slice 2: The Multi-Target Selection Protocol
*   **Objective**: Upgrade the transport layer to handle AoE and multi-target actions.
*   **Tasks**:
    1.  Refactor the Action API input schema to support an optional `targetIds: string[]` array.
    2.  Update the **Macro Action Detector** in `route.ts` to iterate through multiple targets for AoE resolutions.
    3.  Enrich the `COMBAT_CONSEQUENCE` SSE event to support an array of updates to prevent "event flooding" during Meteor Swarms or Fireballs.
*   **Verification**: Type-check `pnpm exec tsc --noEmit`.

### Slice 3: The Authoritative Magic Engine
*   **Objective**: Implement "full-caster" logic in the deterministic fast-path.
*   **Tasks**:
    1.  Integrate `consumeSlot` and `resolveSpellEffect` from `lib/rules/magic.ts` into the `route.ts` fast-path.
    2.  Implement **Saving Throw Logic**: Authoritative d20 rolls against a calculated `Spell Save DC` for targets.
    3.  **Status Persistence**: Actions that apply conditions (e.g., *Stinking Cloud* or *Hold Person*) must mutate the `conditions` Json field in the database during the transaction.
*   **Verification**: Successfully casting "Magic Missile" (multi-target) and "Hold Person" (status application) via API.

### Slice 4: VTT Integration (The Visible Wound)
*   **Objective**: Provide visual and UX feedback for the new mechanical depth.
*   **Tasks**:
    1.  Update `CombatHUD` to render condition icons (status badges) next to combatant HP bars.
    2.  Enhance the targeting UI to allow clicking multiple combatant cards before confirming a spell action.
    3.  Dispatch global events for "Save Success" (shield visual) vs "Save Fail" (impact visual) to the `GameEventHandler`.
*   **Verification**: Manual combat walkthrough verifying that a "Blinded" enemy correctly grants advantage to the player in the UI.

---

## 🛡️ Negative Constraints
- **No LLM Narrative Control**: The AI Narrator may describe *how* a creature is poisoned, but the `Poisoned` condition flag and its mechanical disadvantage MUST be owned by the code.
- **No Local Slot State**: Spell slot counts must never be managed purely in frontend state; they reflect the `Character` table in Prisma.
- **Concentration Integrity**: If a new concentration spell is cast, any existing `concentrationSpellId` must be cleared atomically in the database.

## 🏁 Success Criteria
- [ ] `tsc` passes with 100% type-safety for multi-target actions.
- [ ] Spell slots decrement correctly on cast.
- [ ] Conditions like "Prone" automatically grant advantage in the attack roll logic.
- [ ] The VTT illustrates active status effects clearly.
