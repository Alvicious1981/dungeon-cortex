# Dungeon Cortex — Master Architecture Guide

Status: Authoritative Architecture Source of Truth  
Effective Date: 2026-07-08  
Scope: Architecture law, implementation guardrails, event contracts, and documentation-code drift control

## 1. Purpose

This document resolves historical documentation-code drift and defines authoritative architectural law for Dungeon Cortex implementation. Rules-system canon is delegated to `docs/DECISION_5E_SRD_API.md`, which establishes D&D 5e/SRD 2014 and `https://www.dnd5eapi.co/api` as the active mechanical/data boundary.

When documents conflict, use this precedence order:
1. Explicit user instruction in the active task.
2. `docs/DECISION_5E_SRD_API.md` (rules-system canon and SRD data-source authority).
3. `MASTER_ARCH_GUIDE.md` (this file; architecture and system law authority).
4. `PROJECT_CONTEXT.md` (product baseline).
5. `AGENTS.md` for Codex operating workflow.
6. Current implementation and tests.
7. Historical planning artifacts and reference extracts.

## 2. Consolidated Audit Outcome

Operational integrity: Moderate.  
Current status: Core deterministic backend patterns exist, but implementation truth must always be verified in code and tests before claiming completion.

### Confirmed stable architecture principles

- Server-side mechanical mutation is required for HP, turn updates, spell-slot spending, and campaign-critical state.
- Rules helpers must live in code and not be delegated to narration.
- SSE stream remains the deterministic state-feedback channel for action resolution.
- Documentation claims must be checked against code before implementation.

### Known drift risks

- `COMBAT_CONSEQUENCE` payload consumers have historically drifted between `targets[]`-native and legacy flat-field handling.
- Event emission and event consumption must remain aligned across action paths.
- Backend spell resolution and condition persistence must remain backend-authoritative.
- Missing or stale planning artifacts can create context rot.

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

### LAW-06: D&D 5e/SRD 2014 Is the Only Active Rules System

- `docs/DECISION_5E_SRD_API.md` is the canonical rules-system decision for Dungeon Cortex.
- D&D 5e/SRD 2014 is the only active mechanical rules baseline.
- `https://www.dnd5eapi.co/api` is the primary external SRD data source; local SRD stores may only act as derived caches or adapters.
- AD&D, OSR, retroclone mechanics, THAC0, descending Armor Class, AD&D saving throw categories, and 5e-to-retro conversion paths are non-authoritative and out of scope.
- The backend remains the sole authority for mechanical legality, roll/DC resolution, state mutation, and persistence; AI narration must only describe outcomes already resolved by backend facts.

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

## 5. Obsolescence Registry

This registry defines deprecated fields and legacy logic paths to remove during cleanup after migration safety checks.

### 5.1 Deprecated consequence flat fields

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

### 5.2 Legacy UI update paths

- `components/combat/CombatHUDController.tsx`: single-target update via `payload.targetId` / `payload.hpAfter`.
- `components/combat/ConsequenceLog.tsx`: entry model assumes flat fields and direct `entry.narrativeTags` usage.
- `components/combat/CombatVTT.tsx`: log ingestion currently accepts shape without enforcing targets-array-first rendering model.

### 5.3 Legacy/duplicate action pathways

- `components/combat/MacroDeck.tsx`: non-SSE action path with immediate refresh and no streamed deterministic event handling.
- Parallel client action handlers with overlapping responsibilities (`ActionInput` and `CombatHUDController`) require contract unification.

### 5.4 Legacy route logic and drift debt

- Any `as CombatConsequencePayload` casts that bypass structural safety for consequence payloads.
- Placeholder consequence construction that does not derive complete canonical fields per target.
- Event/type contract drift where frames are typed but never emitted in active route flows.
- Unused imports and duplicated helper logic identified in audits.

## 6. Backend-First Execution Policy

No UI-first implementation is allowed for rules-critical completion. Recommended sequence:

1. Event contract hardening and `targets[]` truth enforcement.
2. Deterministic spell/save/concentration backend completion.
3. Legacy path removal and transport unification.
4. UI integration after backend laws are passing.

## 7. Definition of Done

A consolidation slice is complete only when all are true:

- System Laws are reflected in docs and code contracts.
- Every consequence consumer is `targets[]`-first or explicitly marked as a temporary fallback.
- Spell save DC and concentration saves are backend-authoritative with tests.
- Obsolescence registry items are removed or tracked with explicit migration status.
- Validation commands are reported.
- Codex implementation follows `AGENTS.md`, `docs/CODEX_WORKFLOW.md`, and `MILESTONE_U_CONSOLIDATED_TASKS.md` when relevant.
