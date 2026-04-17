# MILSTONE_U_CONSOLIDATED_TASKS

Status: Definitive Execution Plan  
Date: 2026-04-17  
Mode: Backend-First (UI work gated until backend completion)

## 0. Mission Contract
Milestone U implementation must complete backend deterministic authority before UI expansion.  
No task in UI slices may begin until all backend gates in Phases 1-3 are closed.

## 1. Phase 1 — Consequence Contract Hardening (P0)

1. Normalize `COMBAT_CONSEQUENCE` payload generation so `targets[]` is complete for every target, every path.
2. Remove unsafe consequence payload casting that bypasses structural guarantees.
3. Ensure attack and spell consequence emitters include required canonical target fields (`narrativeTags`, `isFumble`, HP values, kill state, conditions).
4. Enforce turn-advance event emission consistency (`TURN_ADVANCE`/`ROUND_ADVANCE`) on all turn-spending branches.

### Exit Criteria
- No consequence producer depends on legacy flat fields as primary output.
- Event streams remain parse-safe and deterministic for multi-target resolution.

## 2. Phase 2 — Authoritative Magic Resolution Completion (P0)

1. Finalize deterministic spell save execution against backend-calculated save DC (`8 + mod + prof`).
2. Ensure per-target save success/failure drives deterministic damage and condition application.
3. Persist condition outcomes to `Combatant.conditions` inside transaction boundaries.
4. Enforce concentration replacement and concentration-break flows atomically.
5. Ensure concentration saving throw DC is authoritative (`max(10, floor(damage / 2))`).

### Exit Criteria
- Spell actions fully resolve mechanical outcomes server-side without narrative dependency.
- Concentration and condition persistence behave transactionally and predictably.

## 3. Phase 3 — Legacy Path Consolidation (P1)

1. Unify action transport behavior so all combat-critical clients consume deterministic SSE consistently.
2. Retire or migrate non-streaming/non-authoritative action trigger paths.
3. Reconcile event/type drift: either emit documented frames/events or remove obsolete type entries.
4. Remove duplicate/unused legacy helpers and imports identified by the obsolescence registry.

### Exit Criteria
- Single coherent event contract across active combat action clients.
- No orphaned typed event pathways without emitters.

## 4. Phase 4 — Test and Contract Enforcement (P1)

1. Expand rules tests for advantage/disadvantage neutralization, save DC correctness, and concentration checks.
2. Add integration tests for multi-target attack and spell consequences using `targets[]` as assertion basis.
3. Add regression coverage for turn advancement event consistency.

### Exit Criteria
- Backend behavior is test-verified for all System Laws.
- Contract regressions fail fast in CI.

## 5. Phase 5 — UI Integration Unlock (Gated, Post-Backend)

1. Update HUD/VTT to consume `targets[]` natively and apply per-target local state updates.
2. Render condition state from canonical `Combatant.conditions` with deterministic icon mapping.
3. Keep legacy flat-field reads as temporary fallback only during migration window.

### Exit Criteria
- UI no longer depends on deprecated flat consequence fields.
- Local transient feedback matches backend truth before refresh.

## 6. Obsolescence Removal Checklist

1. Remove deprecated flat consequence fields after all consumers migrate.
2. Delete superseded single-target update assumptions in HUD and consequence log components.
3. Remove non-authoritative action handling paths that bypass deterministic stream behavior.
4. Eliminate unused imports/duplicate helper implementations documented in `MASTER_ARCH_GUIDE.md`.

## 7. Definition of Milestone U Completion

Milestone U is complete only when all are true:
1. `targets[]` is the sole consequence source of truth in active consumers.
2. 5e RAW advantage/disadvantage neutralization is verified and enforced.
3. Concentration saves and Spell Save DC calculations are backend-authoritative and test-covered.
4. Legacy paths in the obsolescence registry are removed or explicitly sunset with dated migration notes.
5. UI behavior reflects backend truth without local-rule divergence.
