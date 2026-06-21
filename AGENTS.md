<<<<<<< ours

# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**Dungeon Cortex** is a single-player AI Dungeon Master web application (D&D 5e-inspired). The core promise: a player creates a character, enters a campaign, and interacts with an AI DM that enforces real rules via code — not just narration.

Read `PROJECT_CONTEXT.md` before proposing any architecture changes, major refactors, or multi-file implementations. It is the canonical source of truth.

## Development Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Start dev server at http://localhost:3000
pnpm build                # Production build
pnpm lint                 # ESLint
pnpm typecheck            # tsc --noEmit (no test runner yet)
pnpm prisma migrate dev   # Run pending migrations
pnpm prisma studio        # Database GUI
```

**Environment:** Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `DEV_USER_ID` before running.

## Architecture

The project is a **modular monolith** (Next.js 15 App Router + PostgreSQL via Prisma). Four distinct concerns must stay separate:

| Concern | Location | Role |
|---------|----------|------|
| Narrative | `lib/ai/` (stubbed) | AI generates story text and narration only |
| Rules | `lib/rules/` | Deterministic mechanics — dice, initiative, validation |
| State | `lib/db/` + `prisma/` | Canonical game state; server-owned truth |
| Presentation | `app/`, `components/` | UI panels, combat widgets |

**"Code is Law"** — the AI narrates outcomes; it must never own rules resolution or state mutation. A consequential action must always follow: intent parse → rules validate → state mutate → narrate.

### Key paths

- `lib/rules/dice.ts` — dice notation parser (`roll()`, `d20Check()`, `attackRoll()`, `damageRoll()`)
- `lib/rules/combat.ts` — initiative resolution (`rollInitiative()`)
- `lib/db/prisma.ts` — singleton Prisma client
- `lib/dnd-api/` — D&D 5e API fetch with 24-hour cache
- `app/api/campaign/[id]/action/route.ts` — player action handler (intent routing is stubbed)
- `app/api/campaign/[id]/encounter/route.ts` — combat start (rolls initiative, creates Encounter + Combatants)

### Database entities

`User → Character → Campaign → GameLog`
`Campaign → Encounter → Combatant`
`Character → InventoryItem`

A campaign belongs to one user and one active character. Combat state must be resumable.

## Current Implementation Status

**100% Functional (Backend / Data Triforce):**
- **SRD Ingestion:** Complete for Monsters, Spells, and Equipment. Data is validated with Zod, stored in DB, and fetched via `lib/ai/tools/srd-lookup.ts`.
- **Combat Engine & Intent Parsing:** Complete. Actions are gated deterministically in the API route, parsed via `lib/ai/intent.ts`, and resolved via `executeCombatAction` in `lib/rules/combat.ts`.
- **Inventory Management:** Complete. Equipment gating and ownership validation (`lib/rules/inventory.ts`) are fully integrated and tested via the action route.

**Stubbed / Pending (Skeletons):**
- **Priority 7 (Exploration & Time):** Constant time tracking (`CampaignTimeState`) and dungeon turn logic (`lib/rules/exploration.ts`) are implemented but pending full integration with the API routing and AI intent parser.
- **Narrator Pipeline:** Core is stubbed (`lib/ai/narrator.ts`); depends on semantic memory (`lib/memory/`) for context to avoid hallucination.

## Mechanical Rules Authority (Code is Law)

When planning or making modifications to any file in `lib/rules/` or `lib/db/` related to game mechanics, you MUST first read `docs/reference/Dungeon_Cortex_Rule_Pack_Complete_v2.md` to ensure strict compliance with D&D 5e 2014 SRD rules. Never invent mechanics, hybridize with 5.5e/2024, or use AI narration to resolve rule outcomes.

## Non-negotiable Design Rules

1. **Never fake game state** — do not narrate a spell slot spent without actually decrementing it; do not mark a quest complete without a state mutation.
2. **Prefer server-owned truth** — campaign-critical state lives in the database, not client.
3. **Readability beats spectacle** — combat clarity is higher priority than animation or visual effects.
4. **Modular monolith** — do not split into services unless there is an explicit, justified reason.
5. **Single-player first** — do not add multiplayer complexity unless explicitly requested.
6. **Strict Atomic Execution:** Never stack multiple file modifications or complex tasks in a single response. One action per turn.
7. **Mandatory Type Verification:** IMMEDIATELY after any file modification (`WriteFile` or `SedReplace`), you MUST execute `Bash` with `command="pnpm exec tsc --noEmit"` to verify TypeScript integrity before proceeding.

## Before Any Non-Trivial Task

State briefly:
- what you believe the current implementation state is (verify in code, do not assume)
- which files you will touch
- what the risk is
- how you will validate success

Do not claim a feature is complete unless it has been validated (types pass, logic runs, state actually mutates).

## Open Questions — Surface, Don't Guess

- Which AI provider/model owns the primary runtime narration path?
- Is auth needed before MVP, and what strategy?
- Is battle map mandatory or deferred after combat clarity?
- Is TTS part of MVP?
=======
# AGENTS.md — Dungeon Cortex Codex Cloud Instructions

## 1. Canon de Dungeon Cortex

- Dungeon Cortex usa exclusivamente D&D 5e/SRD 2014.
- `dnd5eapi.co` es la fuente primaria de reglas y datos SRD.
- El backend es autoritativo para legalidad, tiradas, DCs, daño, recursos, condiciones, estado y persistencia.
- La IA solo puede narrar hechos ya resueltos por el backend.
- Está prohibido introducir AD&D, OSR, THAC0, AC descendente, salvaciones retro, moral OSR o XP por oro.

## 2. Reglas de edición

- No tocar reglas, combate, eventos ni pipeline salvo que la tarea lo autorice explícitamente.
- No modificar `.env`, secretos, configuración de despliegue ni base de datos.
- No instalar dependencias sin una tarea específica que lo autorice.
- No abrir PR ni hacer commits salvo autorización explícita.
- No modificar lógica de reglas, combate, eventos, pipeline, downtime, `lib/narrative` ni `tests/narrative` salvo que la tarea lo autorice explícitamente.

## 3. Gestor de paquetes

- Usar el gestor detectado en el repo.
- Si existe `pnpm-lock.yaml`, usar `pnpm`.
- No mezclar `npm`, `yarn`, `pnpm` o `bun`.
- No modificar lockfiles salvo que la tarea autorice explícitamente instalar, actualizar o retirar dependencias.

## 4. Comandos seguros de verificación

Antes de ejecutar scripts, Codex debe comprobar `package.json` para confirmar que existen.

- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `pnpm run check-retro`

## 5. Comandos prohibidos salvo autorización explícita

- `rm -rf`
- `git reset --hard`
- `git clean -fdx`
- Borrar carpetas completas.
- Modificar `.env` o secretos.
- Instalar, actualizar o retirar dependencias.
- Ejecutar migraciones Prisma.
- Cambiar configuración de despliegue.
- Ejecutar seeds o scripts que modifiquen base de datos salvo autorización explícita.

## 6. Política para integrar nuevas librerías

Cada librería debe integrarse en una tarea separada. Cada tarea debe indicar:

- dependencia exacta;
- archivos afectados;
- tests;
- comandos de verificación;
- rollback;
- riesgos.

No se debe instalar ninguna librería si la tarea no autoriza expresamente esa integración.

## 7. Orden recomendado de integraciones

1. MSW
2. ts-pattern
3. TanStack Query
4. Playwright
5. Promptfoo

## 8. Reglas de revisión

Al finalizar cada tarea, Codex debe entregar:

- archivos creados o modificados;
- resultado de `git status --short`;
- resultado de `git diff --stat`;
- comandos ejecutados;
- resultado de los comandos;
- riesgos pendientes;
- confirmación de que no tocó archivos prohibidos.

>>>>>>> theirs
