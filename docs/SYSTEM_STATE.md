# CONSOLIDATED SYSTEM STATE - DUNGEON CORTEX
**Status:** Priority 7 (BSP Dungeon Generator) - COMPLETED 🟢
**Consolidation Date:** 2026-05-06
**Reference Date:** 2026-05-06

## 1. Project Identity & Canon
- **Official Name:** Dungeon Cortex (Replaced legacy names like "Dragons and Dungeons").
- **Core Principle:** "Code is Law" - The backend is the sole authority for state mutation.
- **Data Integrity:** "targets[] is Truth" (LAW-03) - All consequences must derive from the `targets[]` array.

## 2. Current Architecture (April 25)
### Critical Files
- **Rules Engine:** `lib/rules/combat-pipeline.ts`, `lib/rules/combat.ts`, `lib/rules/dice.ts`, `lib/rules/magic.ts`.
- **API Surface:** `app/api/campaign/[id]/action/route.ts`, `Turn` and `Encounter` routes.
- **UI Components:** `CombatHUDController.tsx` (V2), `GameEventHandler.tsx`, `ActionInput.tsx`.
- **Tests:** 29/29 stable tests verified for combat pipeline and API actions.

### Implementation Details
- **Contract:** Payloads strictly contain `attackerName` and the `targets[]` array.
- **SSE Emission:** Clean contract only; no flat field hydration.
- **UI Logic:** Results (isKill, isCrit) are derived by iterating over `targets[]`.
- **Dungeon Mechanics:** Concentration, Spells, and Save DCs are calculated deterministically via Node/Drizzle.

## 3. Stabilization Results (Milestone U)
- **Technical Debt:** Context drift and narrative discrepancies have been eliminated.
- **Backend-First:** Verified flow where UI consumes deterministic states.
- **Prisma Schema:** Canonical source for the database state.

## 4. Archive / Obsolete Registry
The following legacy items are considered archived and must NOT be used for grounding:
- **Especificaciones Extensas UI/UX** (Replaced by V2).
- **Historical TDD Notes / Slices** prior to April 17, 2026.
- **Legacy HUD Logic:** Any single-target HP update logic.

---

## Combat Audit — Phase 0+1 Complete (2026-05-05)
**Score:** 62 → **72 / 100**

### Correcciones aplicadas
- `rollDamage()` usa `rollDie()` — testeable y auditable
- `resolveConcentrationCheck()` eliminada de `combat.ts` (canónica: `resolveConcentrationSave` en `magic.ts`)
- Escudo (+2 AC) en `acFromInventory()`
- Turn guard en action route: 400 si el combatant activo no es el jugador
- MacroDeck deshabilitada + banner visual durante turno enemigo (`isPlayerTurn` prop)
- Condiciones normalizadas (parseo JSON seguro en `CombatHUD`)
- HP numérico en `InitiativeTracker` (via `hpMap` prop)
- Toast `CONCENTRATION_BROKEN` con sonido y alert accesible

### Tests: 6/6 en verde | Schema Prisma: sin cambios

---

## Priority 7 — BSP Dungeon Generator Complete (2026-05-06)
**Tests:** 1550/1550 | **TypeScript:** 0 errores  
**Intervención:** PRIORITY-7-BSP — `rot.js` BSP visual tile layer

### Nuevos archivos
- `lib/rules/dungeon.ts` — generador BSP isomorfo (`generateDungeon`, `getTile`, `computeFOV`, `hasLineOfSight`)
- `lib/hooks/useDungeon.ts` — hook React para grid de tiles + FOV memoizado
- `components/exploration/DungeonMapVTT.tsx` — renderer SVG con pan/zoom, fog of war, marcadores de sala

### Cambios en archivos existentes
- `lib/rules/exploration-logic.ts` — `generateLocationPayload` acepta `options.dungeonMap` para coordinar nodos BSP
- `lib/ai/tools/exploration.ts` — genera `dungeonMap` en `generateLocation` cuando `locationType === "dungeon"`
- `app/campaign/[id]/page.tsx` — renderiza `DungeonMapVTT` condicionalmente para dungeons

### Estado del sistema
- Seed determinista: mismo `Location.seed` → mismo dungeon en cliente y servidor
- Tiles **no** almacenados en DB (generados on-demand desde seed)
- FOV: `RecursiveShadowcasting` con garantía de tile de origen siempre visible
- LOS: Bresenham, utilizable desde API routes para validación de movimiento
- Riesgo documentado: `ROT.RNG` global — concurrencia en servidor requiere mutex a futuro

---

## Combat Audit — Phase 2 Complete (2026-05-05)
**Score objetivo:** 72 → **79 / 100**  
**Intervención:** LAW-04 — Death Saving Throws

### Estado post-implementación

| Módulo | Estado |
|--------|--------|
| `lib/rules/combat.ts` → `resolveDeathSave` | ✅ Implementado + 8 tests |
| `lib/rules/combat.ts` → `resolveEncounterEnd` | ✅ Actualizado: jugador a 0 HP ≠ muerte inmediata |
| `lib/rules/combat-pipeline.ts` → `DEATH_SAVE_REQUIRED` | ✅ Evento emitido en lugar de `ENEMY_DEFEATED` |
| `lib/events/game-events.ts` | ✅ `DEATH_SAVE_REQUIRED` añadido al catálogo |
| `app/api/campaign/[id]/action/route.ts` | ✅ Macro-action `"death_save"` en fast-path |
| `lib/memory/context.ts` | ✅ `ContextCombatant` extendida con campos deathSave |
| `components/combat/MacroDeck.tsx` | ✅ Botón "Tirada de Muerte" cuando `playerHp === 0` |
| `components/combat/InitiativeTracker.tsx` | ✅ Badge "Derribado" cuando `hp === 0` |
| DB Migration | ✅ `deathSaveSuccesses`, `deathSaveFailures` en tabla `Combatant` |
| Tests | ✅ 1535/1535 en verde, 0 errores TypeScript |

### Reglas implementadas (5e 2014 SRD)
- Nat 1 → 2 fallos (fallo crítico)
- Nat 20 → estabilizado (éxito crítico)
- 10–19 → 1 éxito
- 2–9 → 1 fallo
- 3 éxitos → estado `stable`
- 3 fallos → estado `dead` → encounter resuelto
