# Dungeon Cortex — mapa vivo del repositorio

## Metadatos

- **Repositorio:** `Alvicious1981/dungeon-cortex`
- **Rama revisada:** `docs/DOC-001-project-map`
- **Commit de referencia:** `da827f5c1577f761578d566b747de729d0a395bd`
- **Fecha de verificación:** 2026-07-27
- **Alcance:** navegación de la aplicación, reglas, IA, memoria, SRD, persistencia, pruebas, evaluaciones y documentación. Se revisaron los documentos iniciales indicados en DOC-001 y la estructura relevante; no se auditó cada archivo ni se ejecutaron pruebas de código.

## Mapa de áreas

| Área | Responsabilidad comprobable | Punto de entrada representativo |
|---|---|---|
| `app/` | Rutas, páginas, layouts y acciones/API de Next.js. | `app/api/campaign/[id]/action/route.ts` |
| `components/` | Componentes de interfaz para campaña, personaje, combate, exploración e inventario. | `components/combat/CombatHUD.tsx` |
| `lib/rules/` | Servicios y funciones de dominio para resolución de reglas, combate, magia, inventario, exploración y progresión. | `lib/rules/combat-pipeline.ts` |
| `lib/ai/` | Intención, narración y herramientas que conectan la capa de IA con capacidades del dominio. | `lib/ai/intent.ts` |
| `lib/memory/` | Formateo, búsqueda, almacenamiento, embeddings y consolidación de memoria narrativa. | `lib/memory/context.ts` |
| `lib/srd/` | Cliente, esquemas y consultas del adaptador a `dnd5eapi.co`. | `lib/srd/dnd5eapi/client.ts` |
| `prisma/` | Esquema Prisma, migraciones y semilla SRD; representa la persistencia declarada. | `prisma/schema.prisma` |
| `tests/` | Pruebas unitarias, de contrato, arquitectura, API, componentes, memoria, narrativa y SRD. | `tests/rules/combat.test.ts` |
| `evals/` | Evaluación narrativa con Promptfoo, proveedores y aserciones de mecánicas prohibidas. | `evals/narrative/README.md` |
| `docs/` | Documentación operativa, arquitectónica, de API, diseño y decisiones. | `docs/API.md` |

La presencia de un archivo identifica una superficie de responsabilidad, pero no demuestra por sí sola que una función esté completa u operativa. Esa afirmación requiere revisar la implementación y sus pruebas pertinentes.

## Rutas recomendadas para investigar

| Tema | Rutas iniciales |
|---|---|
| Interfaz | `app/campaign/[id]/page.tsx`, `components/campaign/CampaignMobileNav.tsx` |
| API | `app/api/campaign/[id]/action/route.ts`, `docs/API.md` |
| Reglas | `lib/rules/combat-service.ts`, `lib/rules/dice.ts` |
| Combate | `lib/rules/combat-pipeline.ts`, `components/combat/CombatHUDController.tsx` |
| Conjuros | `lib/rules/magic-service.ts`, `lib/rules/spell-resolution-service.ts` |
| Inventario | `lib/rules/inventory.ts`, `app/api/campaign/[id]/inventory/route.ts` |
| Exploración | `lib/rules/exploration-service.ts`, `components/exploration/ExplorationPanel.tsx` |
| Persistencia | `prisma/schema.prisma`, `prisma/migrations/` |
| Memoria narrativa | `lib/memory/store.ts`, `lib/memory/search.ts`, `app/api/campaign/[id]/memories/route.ts` |
| Datos SRD | `lib/srd/dnd5eapi/client.ts`, `lib/srd/dnd5eapi/schemas.ts` |
| Pruebas | `tests/rules/`, `tests/api/`, `tests/architecture/`, `tests/memory/` |

## Fuentes de autoridad

- El código actual, los commits y las pruebas demuestran el estado implementado.
- `AGENTS.md` contiene las reglas operativas para trabajar en el repositorio.
- `docs/DECISION_5E_SRD_API.md` fija el límite D&D 5e/SRD 2014 y la fuente SRD.
- `MASTER_ARCH_GUIDE.md` describe la ley arquitectónica y los contratos del sistema.
- `PROJECT_CONTEXT.md` describe la visión, el alcance y el contexto del producto.
- `docs/API.md` documenta el contrato HTTP/SSE, sujeto a verificación en rutas y pruebas.
- Si una fuente contradice otra, debe declararse la divergencia y aplicarse la precedencia definida por `AGENTS.md` y los documentos arquitectónicos; este mapa no resuelve contradicciones por suposición.

## Documentación principal frente a material heredado

La documentación principal para trabajo actual es `AGENTS.md`, `MASTER_ARCH_GUIDE.md`, `PROJECT_CONTEXT.md`, `docs/DECISION_5E_SRD_API.md`, `docs/API.md` y `docs/CODEX_WORKFLOW.md`. El código y las pruebas siguen siendo la evidencia del estado implementado.

El material histórico o heredado queda separado y no es autoridad de implementación por defecto: `.agents/`, `CLAUDE.md` y `docs/reference/`. Puede consultarse para auditoría o contexto histórico, pero cualquier afirmación actual debe contrastarse con código, commits y pruebas.

## Cuándo revisar este mapa

Revisar `PROJECT_MAP.md` cuando cambien las rutas principales de la aplicación o API, se dividan o renombren las áreas indicadas, cambien las fuentes de autoridad, se modifique el límite de reglas/SRD, aparezca una nueva capa de persistencia o memoria, cambie la organización de pruebas/evaluaciones, o una revisión detecte divergencia entre este documento y el código. La fecha y el commit deben actualizarse en cada revisión.

## Verificación de esta edición

Se comprobaron manualmente las rutas citadas en este documento y la estructura bajo `app/`, `components/`, `lib/`, `prisma/`, `tests/`, `evals/` y `docs/` (excluyendo el inventario masivo de `docs/reference/`). No se modificaron código, pruebas, dependencias, datos, configuración, migraciones, semillas ni secretos.
