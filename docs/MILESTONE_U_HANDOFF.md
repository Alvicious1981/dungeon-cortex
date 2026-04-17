# Milestone U Handoff: The Weave & The Curse

## 1. Executive Summary
Milestone U has successfully transitioned the Dungeon Cortex combat engine from a single-target, semi-authoritative model to a fully deterministic, backend-authoritative Multi-Target & Magic Engine. The VTT UI now natively consumes the refactored SSE transport layer, ensuring 100% synchronization between the Postgres database state and the player's tactical interface.

## 2. Architectural Pillars (Final State)

### A. The `targets[]` Array Supremacy
The `COMBAT_CONSEQUENCE` event payload in `lib/events/game-events.ts` is now the single source of truth for all tactical outcomes.
- **Protocol**: Every attack, spell, or area-of-effect (AoE) action must populate the `targets[]` array.
- **SSE Transport**: The `CombatHUDController.tsx` iterates over this array to apply immediate transient state updates (HP depletion, condition badges) before the final `router.refresh()` at the stream's end.
- **Legacy Fallback**: Flat fields in the payload (e.g., `damage`, `targetId`) are strictly deprecated and preserved only for transitional compatibility.

### B. Backend-Authoritative Magic Engine
Magic resolution has been moved entirely into the `lib/rules/combat.ts` and `lib/api/campaign/[id]/action/route.ts` pipeline.
- **Spell DCs**: Standardized as `8 + Spellcasting Modifier + Proficiency Bonus`.
- **Deterministic Saves**: The backend performs d20 saving throws against the target's modifiers. The result (Success/Fail) is resolved atomically within a Prisma `$transaction`.
- **Condition Persistence**: Conditions (Blinded, Restrained, etc.) are mutated directly in the `Combatant.conditions` JSON array. The VTT merely renders the current state.
- **Concentration**: Concentration disruption is enforced. Damaged combatants undergo a DC 10 (or half-damage) CON save; failure atomically clears `concentrationSpellId`.

### C. VTT Condition Rendering Registry
The UI follows a strict canonical registry defined in [CombatHUD.tsx](file:///d:/dungeon-cortex/components/combat/CombatHUD.tsx).
- **Core 8 Registry**: Strictly maps condition IDs (e.g., `poisoned`, `stunned`) to Lucide icons and official hex color tokens.
- **Motion Specs**: Implements Section 6.3 motion animations:
    - `condition-enter`: 160ms scale-up effect.
    - `critical-hit-impact`: 200ms tactile shake for log entries.
- **AoE Log Layout**: [ConsequenceLog.tsx](file:///d:/dungeon-cortex/components/combat/ConsequenceLog.tsx) provides a consolidated view for multi-target actions, grouping sub-targets under a single "Action Outcome" card to prevent log overflow.

## 3. Tech Stack & Validation
- **Language**: TypeScript 5.x (Strict mode).
- **Styling**: Tailwind CSS v4 + Vanilla CSS animations.
- **Database**: Prisma 6 (v6.x pinned).
- **Quality Gates**: 100% Type-safe (`tsc --noEmit` clean) and ESLint clean.

## 4. Next Frontiers (Milestone V Readiness)

With the deterministic resolution engine stable, the project is ready for **Milestone V: The Chronicler & The Cartographer**.

### Immediate Tactical Next Steps:
1.  **AI Narrator Context Enrichment**: Update the AI prompt to "read" the `targets[]` array in the stream context, allowing it to describe complex AoE outcomes (e.g., "The fireball chars the gnolls while the Knight narrowly dives for cover").
2.  **Hex-Grid Map Integration**: Extend the `targets[]` logic to map-based relative positioning. Transition the current Zone-based layout to the authoritative Wilderness Map.
3.  **Campaign Flow State**: Implement post-combat recovery tools and "Short Rest" logic that atomically clears specific conditions based on the new Condition Registry.
4.  **Advanced Status Interactions**: Implement mechanical penalties (Advantage/Disadvantage) in `combat.ts` based on the active `conditions` array, ensuring the AI can no longer override status-based rules.

---
**Status**: MILESTONE U COMPLETE.
**Security Hash**: `AUTHORITATIVE_WEAVE_SYNC_VERIFIED`
