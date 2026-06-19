# Narrative Safety and Boundaries Specification

This document defines the authoritative guidelines for the narrative execution layer of Dungeon Cortex. It establishes boundaries between mechanical state transitions (backend-first) and fictional representation (AI narration).

## 1. Core Architecture Principles

1. **Separation of Concerns**:
   - **Backend**: Computes checks, rolls dice, checks Armor Class, updates HP, deducts resources, and resolves conditions.
   - **AI Narrator**: Translates the resulting mechanical facts into descriptive prose.

2. **Temporal Ordering (Events First)**:
   - The SSE stream must emit deterministic state frames (e.g. `COMBAT_CONSEQUENCE`, `SPELL_CAST`) **before** any LLM narrative text tokens are streamed.
   - The UI updates immediately based on the deterministic events, ensuring no visual latency.

3. **Strict Fact Alignment**:
   - The narrative must match the resolved facts exactly.
   - If the backend resolved a miss, the AI must not narrate a physical cut or hit. If the target survived, the AI must not narrate death.

## 2. Narrative Safety Blocklist

To prevent the introduction of AD&D/OSR mechanics or jargon, the validation layer and prompt builders must reject the following terms (case-insensitive):

- `morale check` / `tirada de moral` / `chequeo de moral`
- `OSR morale` / `moral OSR`
- `THAC0`
- `AC descendente` / `descending AC`
- `saving throw vs` / `save vs death` / `save vs wands`
- `gold for XP` / `XP por oro`
- `AD&D`
- `OSR`

## 3. Fallback Prose Strategy

If the LLM fails to return a response, experiences high latency, or is blocked by the safety validator, the backend must instantly emit a deterministic, pre-canned description based on the resolved `CombatFacts` (e.g., "The attack misses target's armor", "A clean hit deals X damage").

## 4. Known Legacy Debt Outside This Narrative Roadmap

There exists legacy code outside of the safe narrative boundary that contains forbidden terms or mechanics:
- `lib/ai/tools/downtime.ts` and `lib/rules/downtime.ts` contain remnants of the older AD&D/OSR downtime mechanics.
- These files are out of scope for the current narrative porting roadmap and are not being migrated at this time.
- The `check-retro` hook is configured to protect only the newly introduced narrative layer.
- Any future migration of downtime systems must be executed under a separate implementation plan.
