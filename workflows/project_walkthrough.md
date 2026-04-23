# Dungeon Cortex Technical Walkthrough

## 1) Reglas Inmutables de Diseño (Recordatorio Breve)

- **Code is Law**: la IA narra, pero no decide mecánicas ni muta estado crítico. Toda acción con consecuencias debe pasar por validación mecánica y mutación de estado en servidor.
- **Modular monolith**: separación estricta entre Narrative (`lib/ai/`), Rules (`lib/rules/`), State (`prisma/`, `lib/db/`) y Presentation (`app/`, `components/`).
- **Server-owned truth**: estado canónico de campaña/personaje/combate persistido en Prisma/PostgreSQL; el cliente refleja estado, no lo inventa.
- **Atomicidad mecánica**: cambios críticos (HP, oro, inventario, slots, turnos, encounter status) se aplican en rutas/herramientas con mutación explícita y, cuando corresponde, transacciones.
- **Single-player first**: evitar complejidad multijugador fuera de alcance.

## 2) Auditoría de Hitos 100% Completados y Validados

### Criterio explícito de “100% completado y validado”

Un hito se clasifica como **100% completado y validado** solo si cumple simultáneamente:

1. Está implementado en código ejecutable (reglas puras + orquestación/herramienta/ruta de mutación).
2. Tiene persistencia/modelado en Prisma cuando aplica a estado duradero.
3. Tiene evidencia de validación automatizada sin contradicción activa de contrato para ese alcance.

### Hallazgos cerrados

1. **Separación arquitectónica modular efectiva (Rules/State/AI/Presentation)**
- Evidencia documental en `CLAUDE.md` y realización práctica en árbol de código (`lib/rules/`, `lib/ai/tools/`, `prisma/schema.prisma`, `app/api/...`).
- Los módulos de reglas son mayoritariamente puros; la mutación ocurre en rutas y tools server-side.

2. **Núcleo determinista de combate con integración de estado**
- Reglas: `lib/rules/combat.ts` cubre iniciativa, avance de turno, resolución de ataque, checks de concentración, fin de encuentro, AC derivado.
- Integración: `app/api/campaign/[id]/action/route.ts` y `lib/ai/tools/combat.ts` aplican daño, concentración, avance/resolución y persisten en DB.
- Modelo: `Encounter`/`Combatant`/`Zone` en `prisma/schema.prisma` soportan estado resumible de combate.

3. **Motores de exploración y wilderness autoritativos con estado persistente**
- Dungeon exploration: `lib/rules/exploration.ts` + `lib/rules/exploration-logic.ts` + `lib/ai/tools/exploration.ts` implementan reloj, recursos, encuentros, descanso obligatorio y persistencia.
- Wilderness: `lib/rules/wilderness.ts` + `lib/ai/tools/wilderness.ts` implementan watches, clima, raciones, descubrimiento/scouting hex, encounter checks y actualización transaccional.
- Modelo: `CampaignTime`, `PartyInventory`, `WildernessMap`, `TravelState` en `prisma/schema.prisma`.

4. **Progresión, quests, NPC/social/trade operativos en servidor**
- Progresión/XP/level-up: `lib/rules/progression.ts` + `lib/ai/tools/progression.ts`.
- Quests procedurales: `lib/rules/quests.ts` + tool de persistencia.
- NPC/social: `lib/rules/npc.ts`, `lib/rules/social.ts`, `lib/rules/social-logic.ts` + `lib/ai/tools/social.ts`.
- Trade/economía: `lib/rules/trade.ts` + `executeTrade` con mutación de oro/inventario y registro.

5. **Cobertura de reglas amplia con suite mayormente verde**
- Corrida de validación realizada el **19 de abril de 2026**: **952 tests passing / 953 total** (1 fallo puntual de contrato en social schema test).
- Existe cobertura amplia en `tests/rules/*`, `tests/ai/tools/*`, `tests/api/*`.

## 3) Roadmap de Hitos Stubbed/Pendientes (Ordenado por Estabilidad)

### Estado parcial / drift detectado

1. **Intent parsing (parcial)**
- Existe `lib/ai/intent.ts` y se integra en `app/api/campaign/[id]/action/route.ts`.
- Gap: sin batería dedicada robusta de tests para clasificación/errores y acoplamiento alto a una ruta monolítica.

2. **Spell slots (parcial)**
- Núcleo sólido en `lib/rules/magic.ts` (shape, consumo, restauración, tablas de slots).
- Gap: ciclo de vida heterogéneo entre creación de personaje, acción principal, endpoint dedicado de cast y cobertura por clase/ruta.

3. **Resolución completa de turnos de combate (parcial)**
- Base fuerte: iniciativa, ataque, concentración, encounter end, eventos SSE.
- Gap: pipeline todavía con duplicidad de ramas en `action/route.ts`; falta consolidación de loop de turno end-to-end en un flujo único y menos divergente.

4. **Drift de contrato social (pendiente inmediato)**
- El test `tests/rules/social.test.ts` espera `characterId` en `SocialCheckInputSchema`, pero el schema actual es `strict` y no lo admite.
- Resultado: 1 fallo activo en suite (953 total).

5. **Stub explícito en inventario (pendiente)**
- `validateItem()` en `lib/rules/inventory.ts` contiene TODO explícito de validación profunda por tipo/datos de reglas.

### Próximo paso lógico recomendado (prioridad secuencial)

1. **Reconciliar contrato y tests para dejar la suite totalmente verde**
- Resolver inmediatamente el desalineamiento de `SocialCheckInputSchema` vs tests.

2. **Unificar pipeline de acción/combate en una ruta de resolución canónica**
- Reducir duplicidad de ramas y garantizar semántica uniforme de eventos/turnos.

3. **Completar orquestación de turnos de combate end-to-end**
- Consolidar consumo de acción, avance de turno/ronda y cierre de encounter en un ciclo homogéneo.

4. **Endurecer intent parsing**
- Añadir tests dedicados (clasificación, ambigüedad, fallback determinista).

5. **Normalizar lifecycle completo de spell slots por clase/ruta**
- Alinear creación, consumo, recuperación y validación en todos los entrypoints.

6. **Cerrar TODOs de inventario con validación profunda**
- Completar `validateItem()` con reglas por tipo y checks de integridad mecánica.

**Nota de gobierno de verdad:** para priorización técnica, prevalece el estado real del código + evidencia de tests sobre texto histórico desactualizado en `CLAUDE.md` cuando haya discrepancias.
