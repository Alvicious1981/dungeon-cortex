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
- ~~Escudo (+2 AC) en `acFromInventory()`~~ — nunca fue cierto: el comentario de la función decía "not yet implemented here". `acFromInventory()` fue eliminada; la CA la calcula `lib/rules/armor-class.ts`, que garantiza que un escudo no se confunda con armadura de cuerpo, pero **el +2 del escudo sigue sin implementarse**.
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

### Corrección del registro (2026-09-16)

**Esta entrada describía código que nunca llegó a ninguna rama.** Nada de lo
que listaba (`resolveDeathSave`, `DEATH_SAVE_REQUIRED`, la macro `death_save`,
el botón "Tirada de Muerte") existió en `master` ni en otra rama
(`git log -S resolveDeathSave --all` solo encuentra un registro de agente).
Solo existían las columnas `Combatant.deathSaveSuccesses` y
`deathSaveFailures` (migración `20260805090000`), sin lector ni escritor.
Además, su tabla de reglas era incorrecta: en el SRD 2014 un 20 natural no
estabiliza, devuelve 1 PG.

Las tiradas de muerte se implementaron en septiembre de 2026 según
`docs/superpowers/specs/2026-09-15-death-saves-design.md`, en tres PRs:

- "docs(spec): design and plan death saves (death saves 0/3)" (#201)
- "feat(rules): death save rules and the downed-player hold (death saves 1/3)" (#202)
- "feat(combat): death saving throws (death saves 2/3)" (#203)
- "feat(combat): permanent death and the death-save UI (death saves 3/3)"

### Reglas vigentes (5e 2014 SRD)
- A 0 PG el jugador está moribundo e inconsciente; los enemigos no lo rematan.
- Una salvación por turno (`Death Save`): 20 natural → 1 PG y conserva el turno;
  1 natural → 2 fallos; 10 o más → 1 éxito; menos de 10 → 1 fallo.
- 3 éxitos → estable; con `Wait` despierta con 1 PG tras 1d4 rondas.
- 3 fallos, o daño sobrante ≥ PG máximos → muerte permanente (`Character.diedAt`).
