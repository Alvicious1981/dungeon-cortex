---
title: Decision — D&D 5e/SRD 2014 and dnd5eapi.co Mechanical Boundary
status: Accepted
date: 2026-06-15
scope: Global project architecture, rules engine, AI narration, SRD data access
---

# Decision — D&D 5e/SRD 2014 and dnd5eapi.co Mechanical Boundary

## 1. Decision

Dungeon Cortex will scale using only D&D 5e/SRD 2014 mechanics and SRD data available through the free API:

https://www.dnd5eapi.co/api

This decision supersedes any previous documentation, milestone, reference note, or implementation plan that recommends or depends on AD&D, OSR, retroclone mechanics, THAC0, descending Armor Class, AD&D saving throw categories, gold-for-XP progression, 2d6 AD&D reaction rolls, morale systems, or conversions from 5e data into retro rules.

## 2. Precedence

When documents conflict, use this order:

1. Explicit user instruction in the active conversation.
2. `docs/DECISION_5E_SRD_API.md`.
3. `MASTER_ARCH_GUIDE.md`.
4. `PROJECT_CONTEXT.md`.
5. Compatible specs and current implementation plans.
6. Historical milestone notes and reference extracts.

Historical OSR/AD&D documents are non-authoritative unless they are explicitly rewritten for D&D 5e/SRD 2014 compatibility.

## 3. Non-goals and prohibitions

Dungeon Cortex must not use:

- AD&D retro mechanics.
- THAC0.
- Descending Armor Class.
- AD&D saving throw categories.
- OSR/retro morale, reaction, loyalty, or exploration procedures as authoritative mechanics.
- Gold-for-XP as a primary advancement mechanic unless explicitly redefined as a non-authoritative campaign option outside core scope.
- Any conversion layer that takes 5e/SRD data and resolves it with retro rules.

## 4. Allowed mechanical baseline

The allowed rules baseline is:

- D&D 5e 2014 SRD.
- d20 attack rolls against ascending Armor Class.
- D&D 5e ability checks.
- D&D 5e saving throws by ability score.
- D&D 5e proficiency bonus.
- D&D 5e spell save DC formula: `8 + spellcasting ability modifier + proficiency bonus`.
- D&D 5e concentration save formula: `max(10, floor(damage / 2))`.
- D&D 5e advantage/disadvantage neutralization.
- D&D 5e conditions available from SRD.
- D&D 5e combat, spell, equipment, monster, and character data where available in SRD/API.

## 5. SRD data source

The canonical external data source is:

`https://www.dnd5eapi.co/api`

The backend may cache SRD data locally for latency, resilience, tests, or offline development, but cached data must be treated as derived data.

Local SRD tables, seed files, or JSON imports must record enough provenance to identify their dnd5eapi source endpoint and must not silently diverge from the canonical API shape without an explicit adapter.

## 6. Backend authority

The backend is the only mechanical authority.

The backend must:

- validate action legality;
- fetch or read SRD data;
- roll dice or consume deterministic roll inputs in tests;
- calculate modifiers, DCs, attack totals, damage, healing, conditions, resources, XP, spell slots, movement, AoE membership, and death/defeat states;
- persist all campaign-critical state;
- emit deterministic events before narrative text.

The frontend may render state and collect player intent, but must not independently resolve authoritative mechanics.

## 7. AI narrator boundary

The AI may:

- parse or clarify natural language intent;
- request backend tools;
- narrate resolved outcomes;
- describe mood, sensory detail, NPC voice, and scene continuity using facts returned by backend.

The AI must not:

- invent AC, HP, DCs, saves, monster stats, spell effects, equipment properties, XP, loot, conditions, or damage;
- decide whether an attack hits;
- decide whether a save succeeds;
- mutate campaign-critical state directly;
- narrate a mechanical result before backend resolution.

## 8. Existing contradiction cleanup

The following areas must be reviewed and either rewritten or marked obsolete:

- OSR/AD&D exploration reference docs.
- Milestone Q downtime/haven specification.
- AD&D 2d6 reaction roll implementation and AI tool description.
- Any “OSR Exploration Time Engine” naming in schema, docs, or code.
- Open5e/Magical20 references where they are presented as canonical mechanical authority.
- Any tool description that implies the AI resolves mechanics rather than narrating backend results.

## 9. Implementation policy

New work must be backend-first.

Recommended sequence:

1. Update canonical docs with this decision.
2. Mark incompatible historical docs as obsolete.
3. Introduce or update dnd5eapi data adapter/caching strategy.
4. Replace AD&D/OSR social, exploration, downtime, and morale mechanics.
5. Add regression tests proving no THAC0, descending AC, AD&D saves, or retro conversion paths remain.
6. Update AI tool descriptions and prompts so narration follows backend facts only.

## 10. Definition of done

This decision is fully implemented when:

- canonical docs state the 5e/SRD 2014 + dnd5eapi boundary;
- incompatible docs are obsolete or rewritten;
- backend modules no longer expose AD&D/OSR mechanics as authoritative;
- SRD data access is traceable to dnd5eapi or a derived cache;
- AI prompts/tools enforce “narrate only after backend resolution”;
- tests cover the absence of forbidden retro mechanics.
