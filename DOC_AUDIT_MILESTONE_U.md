# DOC_AUDIT_MILESTONE_U

Date: 2026-04-17
Auditor: GPT Codex (Architectural Deep Scan)
Scope: Milestone U pre-UI audit for multi-targeting and conditions integration.

## 1) Audit Scope and Inputs

### Requested docs
- Read: `docs/MILESTONE_T_HANDOFF.md`
- Read: `docs/MILESTONE_U_SPEC.md`
- Missing in repository: `task.md`
- Missing in repository: `implementation_plan.md`

### Requested code areas
- `lib/rules/`
- `lib/events/`
- `app/api/campaign/`
- `components/combat/`

### Verification run
- `pnpm exec tsc --noEmit` -> PASS
- `pnpm test -- tests/api/action.test.ts tests/rules/conditions.test.ts` -> PASS

## 2) Executive Summary

Project status is operational but architecturally drifted in the combat UI integration layer.

- Deterministic mechanical authority is mostly preserved on the server side (HP, turn, slots are code-mutated, not narrated).
- However, transport and UI synchronization are partially inconsistent with Milestone T/U intent, especially for multi-target consequences and turn advancement events.
- Backend support for Milestone U magic depth is incomplete (saving throws, concentration integrity, spell-driven condition persistence).
- There is meaningful context rot in docs (`task.md`, `implementation_plan.md` absent) and in compatibility layers that should now be retired.

Overall integrity rating: **Moderate (6.5/10)**
Readiness for Slice 3 UI work (multi-target + conditions): **Partial; requires backend alignment first**.

## 3) Code Is Law Validation

### Confirmed compliant
- Action route performs deterministic state mutation server-side before narration (`app/api/campaign/[id]/action/route.ts`).
- Rules modules are pure/mechanical (`lib/rules/combat.ts`, `lib/rules/magic.ts`, `lib/rules/conditions.ts`).
- Prompt contract explicitly forbids AI mechanical authority (`lib/memory/formatter.ts`, `lib/ai/narrator.ts`, `lib/ai/intent.ts`).

### Drift risks (not a full break, but weakening)
- Multiple action clients parse the same SSE contract differently:
  - Full parser: `app/campaign/[id]/ActionInput.tsx`
  - Partial parser: `components/combat/CombatHUDController.tsx`
  - Non-SSE handling path: `components/combat/MacroDeck.tsx`
- Mechanical mutations can occur via several pathways with divergent post-mutation event behavior.

Conclusion: Code-is-law principle is **not broken at core resolution**, but **integration consistency is degraded**.

## 4) High-Impact Findings (Priority Ordered)

## P0 - Multi-target SSE payload is structurally incomplete in macro attack path
- File: `app/api/campaign/[id]/action/route.ts` (macro Attack branch)
- Issue:
  - `targets` entries omit fields expected by type/UI (`narrativeTags`, `isFumble`).
  - Legacy flat payload maps `narrativeTags: consequences[0].narrativeTags` which is undefined.
  - Cast (`as CombatConsequencePayload`) bypasses type safety.
- Risk:
  - `ConsequenceLog.tsx` directly calls `entry.narrativeTags.slice(...)`; undefined can crash render.
  - Multi-target UI cannot rely on payload correctness.

## P0 - CombatHUDController applies only legacy single-target fields
- File: `components/combat/CombatHUDController.tsx`
- Issue:
  - For `COMBAT_CONSEQUENCE`, local state update uses only `payload.targetId` / `payload.hpAfter`.
  - Ignores `payload.targets[]` array entirely.
- Risk:
  - Multi-target damage appears stale for all but first target until final refresh.
  - Violates intended zero-latency feedback for Slice 2+.

## P0 - Turn advancement state mutation without corresponding event in attack flows
- File: `app/api/campaign/[id]/action/route.ts`
- Issue:
  - Attack and spell branches update `Encounter.currentTurnIndex`/`round` but do not emit `TURN_ADVANCE`/`ROUND_ADVANCE` event.
- Risk:
  - `CombatHUDController` transient turn indicator can desync until `done` refresh.
  - Breaks explicit Milestone T expectation of instant deterministic turn feedback.

## P1 - Authoritative magic engine incomplete versus Milestone U spec
- File: `app/api/campaign/[id]/action/route.ts`, `lib/rules/magic.ts`
- Missing/partial:
  - No deterministic save-roll vs Spell Save DC execution in action route.
  - No spell-driven condition persistence to `Combatant.conditions` in cast flow.
  - No concentration replacement/clearing transaction flow despite available helpers.
  - No multi-target spell resolution via `targetIds` (currently attack-only).
- Risk:
  - Backend cannot yet fully support planned Slice 3/4 UI semantics for magic + conditions.

## P1 - Legacy compatibility layer is still primary UI contract
- Files: `lib/events/game-events.ts`, `components/combat/ConsequenceLog.tsx`, `components/combat/CombatHUDController.tsx`
- Issue:
  - `targets[]` exists but UI still depends on deprecated flat fields.
- Risk:
  - Architectural debt blocks clean multi-target UI and invites hidden regressions.

## P1 - Unimplemented event pathways and event/type drift
- Files: `lib/events/game-events.ts`, `app/campaign/[id]/ActionInput.tsx`, `components/combat/CombatVTT.tsx`
- Issue:
  - `LOOT_GENERATED` is consumed in VTT but not emitted by action stream.
  - `dialogue_open` / `dialogue_update` are in stream type and ActionInput handlers, but current action route does not emit them.
- Risk:
  - Orphaned pathways increase confusion and maintenance cost.

## P2 - Redundancy and orphaned logic/types
- `removeCondition` imported in action route but unused.
- `extractConditions` duplicated (`lib/rules/combat.ts` and `lib/memory/formatter.ts`).
- Concentration helpers (`beginConcentration`, `breakConcentration`) are defined but not integrated in action flows.
- Spell slot shape mismatch risk exists in page UI parser (`total/used`) vs canonical rules shape (`current/max`).

## 5) Backend Reality vs Slice 3 UI Plan

| Capability | Current State | Audit Verdict |
|---|---|---|
| Multi-target attack transport (`targetIds`) | Implemented in macro Attack path | Partial (payload contract drift) |
| Batched consequence payload (`targets[]`) | Implemented server-side | Partial (UI still legacy fields) |
| Condition-aware attack advantage/disadvantage | Implemented (`evaluateAdvantage`) | Ready for UI readout |
| Spell slot authoritative consumption | Implemented in cast branch | Partial (branch coverage gaps) |
| Save throw mechanics (Spell Save DC) | Not implemented in action route | Blocker |
| Condition persistence from spells | Not implemented | Blocker |
| Concentration integrity atomics | Not implemented | Blocker |
| Turn advance SSE consistency after attacks/spells | Not implemented | Blocker for real-time HUD confidence |

## 6) Official Slice 3 UI Aesthetic Rules (Formalized Spec)

This section is now normative for Milestone U Slice 3 UI integration.

## 6.1 Condition render model
- Source of truth: `Combatant.conditions` only.
- Rendering mode: icon-first status badges with deterministic mapping.
- Badge layout: horizontal row, max 8 visible badges, overflow into `+N` chip.
- Badge order: deterministic alphabetical by canonical condition ID.

## 6.2 Canonical Condition Icon Registry (8-core set)

Use exact Lucide names below:

| Condition ID | Label | Lucide Icon | Color Token |
|---|---|---|---|
| `blinded` | Blinded | `EyeOff` | `--cond-blinded: #94A3B8` |
| `poisoned` | Poisoned | `FlaskConical` | `--cond-poisoned: #84CC16` |
| `prone` | Prone | `ArrowDown` | `--cond-prone: #F97316` |
| `restrained` | Restrained | `Link2` | `--cond-restrained: #06B6D4` |
| `stunned` | Stunned | `ZapOff` | `--cond-stunned: #EAB308` |
| `paralyzed` | Paralyzed | `Hand` | `--cond-paralyzed: #A78BFA` |
| `unconscious` | Unconscious | `MoonStar` | `--cond-unconscious: #64748B` |
| `invisible` | Invisible | `Ghost` | `--cond-invisible: #67E8F9` |

Compatibility note:
- If a condition not in this registry appears, render fallback icon `AlertTriangle` and token `--cond-unknown: #EF4444`.

## 6.3 Motion and timing standard

- `condition-enter`: `160ms` ease-out, opacity 0 -> 1 and scale 0.92 -> 1.00.
- `condition-exit`: `120ms` ease-in, opacity 1 -> 0 and scale 1.00 -> 0.92.
- `condition-refresh-pulse`: `900ms` ease-in-out glow pulse when condition list changes.
- `condition-critical-impact`: `220ms` subtle shake only when a condition is newly applied by mechanical event.
- `reduced-motion`: disable shake and pulse; keep opacity fade only (`100ms`).

## 6.4 Multi-target interaction spec

- Consequence handling must iterate `payload.targets[]` always.
- Legacy flat fields are read-only fallback during transition and must not drive primary UI updates.
- Local transient updates must apply per-target HP and conditions before `router.refresh()`.

## 7) Refactor Targets (Concrete File Queue)

## Immediate (before Slice 3 UI coding)
1. `app/api/campaign/[id]/action/route.ts`
2. `components/combat/CombatHUDController.tsx`
3. `components/combat/ConsequenceLog.tsx`
4. `lib/events/game-events.ts`

## Next (same milestone)
1. `lib/rules/magic.ts` + integration points in `action/route.ts` (saving throws, concentration, condition persistence)
2. `components/combat/CombatHUD.tsx` (replace letter slots with icon registry)
3. `components/combat/CombatVTT.tsx` (targets-array-native consequence rendering)

## Cleanup
1. `components/combat/MacroDeck.tsx` and `app/campaign/[id]/ActionInput.tsx` action-path consolidation
2. Remove deprecated flat consequence fields after migration completion
3. Restore missing project docs: `task.md`, `implementation_plan.md`

## 8) Go/No-Go Recommendation

Recommendation: **Conditional Go**.

Proceed to Slice 3 UI only after the following blockers are resolved:
1. Make `COMBAT_CONSEQUENCE` payload complete and targets-array-first.
2. Emit deterministic turn-advance events for all turn-spending attack/spell paths.
3. Implement backend save-throw + condition persistence + concentration rules for spell actions.
4. Unify SSE handling contract across action clients (or formally deprecate extra clients).

Without these, UI work will likely encode temporary behavior and amplify context rot.
