---
name: narrative-canon
description: Safe narrative design system for D&D 5e/SRD 2014 in Dungeon Cortex, preventing OSR/AD&D leakage.
---

# Narrative Canon Skill — Safe Narrative Design System

This skill enforces strict D&D 5e/SRD 2014 compliance for all AI narrative generation features in Dungeon Cortex. It prevents the porting or implementation of OSR, AD&D, or retroclone mechanics.

## Core Directives

1. **Backend Authoritativeness**
   - The backend rules engine resolves all mechanical details (hits, damage, saves, DC check results, condition states, resource spending).
   - The AI narrator acts as a passive describer of resolved facts and must never invent or decide mechanical outcomes.

2. **Advantage/Disadvantage and 5e Rules**
   - All rolls must use 5e rules (e.g. advantage/disadvantage neutralization, Spell Save DCs, concentration saves).
   - Do not use retro static modifiers in place of advantage/disadvantage.

3. **Forbidden Terminology**
   - Strictly avoid OSR, AD&D, and retro terms.
   - Any reference to the forbidden list must trigger a validation block or a deterministic fallback description.

## Prohibited Concepts

- **THAC0 & Descending AC**: Always use ascending AC and d20 total vs AC.
- **Retro Saves**: Do not use saving throw categories (e.g., Death, Wands). Use 5e ability saving throws.
- **OSR Morale**: Do not implement moral checks or reaction tables.
- **Gold-for-XP**: Progression is strictly milestone or standard 5e XP.
