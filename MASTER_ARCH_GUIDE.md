# Dungeon Cortex — Master Architecture Guide

Status: Authoritative Source of Truth  
Effective Date: 2026-04-17  
Scope: Milestone U consolidation slice and downstream implementation guardrails

## 1. Purpose
This document resolves historical documentation-code drift and defines authoritative architectural law for Milestone U execution.

When documents conflict, use this precedence order:
1. Explicit user instruction in the active conversation.
2. `MASTER_ARCH_GUIDE.md` (this file).
3. `PROJECT_CONTEXT.md` (product baseline).
4. Milestone specs and historical planning artifacts.

## 2. Consolidated Audit Outcome
Audit date: 2026-04-17  
Operational integrity: Moderate (6.5/10)  
Current status: Core deterministic backend is functional, but integration contracts are drifted and partially legacy-driven.

### Confirmed stable
- Server-side mechanical mutation is active for HP, turn updates, spell-slot spending.
- Rules helpers are in code (combat, magic, conditions) and not delegated to narration.
- SSE stream remains the deterministic state-feedback channel.

### Confirmed drift
- `COMBAT_CONSEQUENCE` payload consumers are split between targets-array-native and legacy flat-field handling.
- Event emission and event consumption are not fully aligned across action paths.
- Backend spell resolution is partially implemented but still includes placeholder/legacy logic paths.
- Missing planning artifacts created context rot (`task.md`, `implementation_plan.md`).

## 3. System Law (Non-Negotiable)

### LAW-01: `targets[]` Is Primary Truth for Consequences
- Canonical consequence payload source is `COMBAT_CONSEQUENCE.payload.targets[]`.
- All UI/state sync paths must iterate `targets[]`.
- Flat consequence fields (`targetId`, `hpAfter`, etc.) are transitional fallback only and are deprecated.

### LAW-02: 5e RAW Adv/Dis Neutralization Is Active
- Advantage/disadvantage resolution follows 5e RAW neutralization: if both are present, they cancel and result is a normal roll.
- Condition-driven advantage/disadvantage must be computed by deterministic rules helpers only.

### LAW-03: Concentration Saves Are Backend-Authoritative
- Concentration checks execute on backend state mutation paths only.
- Concentration save DC must follow RAW formula: `max(10, floor(damage / 2))`.
- Concentration state (`concentrationSpellId`) must be mutated atomically in DB transactions.

### LAW-04: Spell Save DC Is Backend-Authoritative
- Spell save DC calculation is backend-only.
- Canonical formula is `8 + spellcasting ability modifier + proficiency bonus`.
- Frontend must never independently compute authoritative save DC outcomes.

### LAW-05: Combat Conditions Are State Truth
- `Combatant.conditions` is canonical for condition state.
- Rendering, advantage/disadvantage derivation, and persistence flows must read from this backend state.

## 4. Current Architecture Truth Map

### 4.1 Transport and Event Contract
- Stream format remains `ActionStreamFrame` over SSE.
- Deterministic game events must be emitted before narrative tokens.
- Any event listed in shared type contracts but never emitted is contract debt and must be reconciled.

### 4.2 Resolution Authority
- Intent parsing may suggest action semantics.
- Mechanical legality, roll resolution, DC checks, and persistence are backend responsibility.
- Narration is post-resolution and non-authoritative.

### 4.3 Multi-target Contract
- Multi-target transport exists (`targetIds`) and must remain backend-first.
- Consequences must be batched in one `COMBAT_CONSEQUENCE` frame using `targets[]`.
- Local UI feedback should update each target before final refresh.

## 5. Obsolescence Registry (Removal Queue)
This registry defines deprecated fields and legacy logic paths to remove during the cleanup phase after migration safety checks.

### 5.1 Deprecated consequence flat fields (remove after consumers migrate)
- `CombatConsequencePayload.targetId`
- `CombatConsequencePayload.targetName`
- `CombatConsequencePayload.damage`
- `CombatConsequencePayload.hpAfter`
- `CombatConsequencePayload.targetMaxHp`
- `CombatConsequencePayload.isCrit`
- `CombatConsequencePayload.isFumble`
- `CombatConsequencePayload.naturalRoll`
- `CombatConsequencePayload.isKill`
- `CombatConsequencePayload.hitLocation`
- `CombatConsequencePayload.narrativeTags`

### 5.2 Legacy UI update paths (replace with `targets[]` iteration)
- `components/combat/CombatHUDController.tsx`: single-target update via `payload.targetId` / `payload.hpAfter`.
- `components/combat/ConsequenceLog.tsx`: entry model assumes flat fields and direct `entry.narrativeTags` usage.
- `components/combat/CombatVTT.tsx`: log ingestion currently accepts shape without enforcing targets-array-first rendering model.

### 5.3 Legacy/duplicate action pathways (consolidate)
- `components/combat/MacroDeck.tsx`: non-SSE action path with immediate refresh and no streamed deterministic event handling.
- Parallel client action handlers with overlapping responsibilities (`ActionInput` and `CombatHUDController`) require contract unification.

### 5.4 Legacy route logic and drift debt
- Any `as CombatConsequencePayload` casts that bypass structural safety for consequence payloads.
- Placeholder consequence construction that does not derive complete canonical fields per target.
- Event/type contract drift where frames are typed but never emitted in active route flows.
- Unused imports and duplicated helper logic identified in audit:
  - `removeCondition` import in action route (unused).
  - duplicated `extractConditions` logic surface across modules.

## 6. Backend-First Execution Policy for Milestone U
No UI-first implementation is allowed for Milestone U completion. Sequence is mandatory:
1. Event contract hardening and targets-array truth enforcement.
2. Deterministic spell/save/concentration backend completion.
3. Legacy path removal and transport unification.
4. UI integration after backend laws are fully passing.

## 7. Definition of Done (Consolidation Slice)
Consolidation slice is complete only when all are true:
- System Laws (Section 3) are encoded in docs and reflected in code contracts.
- Every consequence consumer is `targets[]`-first.
- Spell save DC and concentration saves are backend-authoritative with tests.
- Obsolescence registry items are either removed or tracked with explicit migration status.
- Milestone U execution follows `MILSTONE_U_CONSOLIDATED_TASKS.md`.
