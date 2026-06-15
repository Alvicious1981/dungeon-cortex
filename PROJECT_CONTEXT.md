---
title: Dungeon Cortex — Project Context & Source of Truth
version: 1.2
adapted_from: dungeon-cortex-tdd-v4.md
adapted_on: 2026-04-17
intended_location: project-root/PROJECT_CONTEXT.md
purpose: Canonical product context; rules canon delegated to docs/DECISION_5E_SRD_API.md and architecture authority to MASTER_ARCH_GUIDE.md.
status: Active, with Milestone U consolidation alignment.
---

# Dungeon Cortex — Project Context & Source of Truth

## 1. How this file must be used

This file remains the canonical product and scope context for Dungeon Cortex.  
For rules-system canon, use `docs/DECISION_5E_SRD_API.md` as authoritative.
For architecture law, event contracts, and Milestone U truth alignment, use `MASTER_ARCH_GUIDE.md` as authoritative.

Precedence order:
1. Explicit user instruction in the current conversation.
2. `docs/DECISION_5E_SRD_API.md` (rules-system canon and SRD data-source authority).
3. `MASTER_ARCH_GUIDE.md` (architecture and system law authority).
4. `PROJECT_CONTEXT.md` (product vision and scope authority).
5. Compatible current specs and narrow project rules/skills in `.agents/`.
6. Historical TDD/spec notes.

## 2. Consolidation Notice (Milestone U)

On 2026-04-17, the project entered a documentation consolidation phase to resolve context drift.

Effective governance:
- D&D 5e/SRD 2014 is the only active rules system.
- `https://www.dnd5eapi.co/api` is the primary external SRD data source.
- AD&D, OSR, retroclone mechanics, THAC0, descending Armor Class, AD&D saving throws, and 5e-to-retro conversion paths are out of scope.
- Backend-first delivery is mandatory for Milestone U.
- Consequence transport truth is `targets[]`-first.
- Deterministic rules mutation remains non-negotiable.
- Deprecated compatibility fields and legacy logic paths are tracked in `MASTER_ARCH_GUIDE.md`.

## 3. Product identity

**Project name:** Dungeon Cortex  
**Product type:** Single-player AI Dungeon Master web application inspired by tabletop Dungeons & Dragons.

Core promise:
A player can create a character, enter a campaign quickly, interact with an AI Dungeon Master, and experience deterministic rules-backed play with stronger immersion than a plain chat interface.

## 4. Non-negotiable design pillars

1. **Code is Law**  
   The AI may narrate, but game rules and state transitions must be validated by backend code.

2. **D&D 5e/SRD 2014 only**  
   Dungeon Cortex uses D&D 5e/SRD 2014 as its only active mechanical rules system. AD&D, OSR, retroclone rules, THAC0, descending Armor Class, AD&D saving throws, and conversions from 5e data to retro mechanics are out of scope.

3. **dnd5eapi.co as primary external SRD source**  
   `https://www.dnd5eapi.co/api` is the primary external source for SRD data. Local data may be cached or derived, but must not become a competing rules authority.

4. **Backend mechanical authority**  
   The backend validates legality, resolves rolls/DCs/damage/resources/state, persists campaign-critical changes, and emits deterministic facts before narration.

5. **AI narration boundary**  
   The IA/AI may parse intent and narrate resolved outcomes, but must not invent or decide AC, HP, DCs, saves, spell effects, monster stats, loot, XP, conditions, or other mechanical results.

6. **Single-player first**  
   Multiplayer complexity is out of scope unless explicitly requested.

7. **Diegetic immersion with clarity**  
   Presentation should reinforce fiction without obscuring deterministic state.

8. **Fast time-to-fun**  
   The path from first launch to first meaningful session must be short.

9. **Incremental trust**  
   Never imply mechanics or persistence that backend code did not execute.

## 5. Scope and delivery baseline

### P0
1. Character creation
2. Campaign start
3. Narrative chat loop with streaming
4. Rules-backed checks and combat resolution
5. Persistent player/campaign state
6. Basic inventory and spell support
7. Minimum viable combat UI

### P1
1. Initiative and combat readability improvements
2. Quest journal and NPC continuity
3. Mobile and accessibility hardening

### P2
1. Tactical map depth
2. Audio/TTS polish
3. Monitoring and production-quality resilience

## 6. Implementation rules

- Separate intent parsing, rules validation, state mutation, and narration.
- Keep campaign-critical state backend authoritative.
- Prefer modular monolith over premature decomposition.
- Validate completion with type checks/tests/manual flow verification before claiming done.

## 7. Canonical companion documents

- `docs/DECISION_5E_SRD_API.md` — Rules-system canon, dnd5eapi.co source decision, forbidden legacy mechanics.
- `MASTER_ARCH_GUIDE.md` — Architecture law, truth alignment, obsolescence registry.
- `MILSTONE_U_CONSOLIDATED_TASKS.md` — Definitive backend-first Milestone U execution queue.


## 8. Operating summary

Build Dungeon Cortex as a deterministic single-player AI-DM experience using D&D 5e/SRD 2014 only.  
Use `https://www.dnd5eapi.co/api` as the primary external SRD data source.  
Protect backend mechanical truth before presentation polish.  
Let the AI narrate only outcomes already resolved by backend code.  
Follow backend-first Milestone U sequencing to avoid context rot.
