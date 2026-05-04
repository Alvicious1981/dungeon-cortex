# CONSOLIDATED AGENT LOG - DUNGEON CORTEX
**Status:** Unified Operational Protocol
**Consolidation Date:** 2026-05-04
**Reference Date:** 2026-04-29

## 1. Multi-Agent Orchestration Framework
The Dungeon Cortex project utilizes a tiered agent architecture within the Antigravity Manager:

- **Control Plane (Architect):** Gemini 3.1 Pro (High/Low) - Handles reasoning, planning, and architectural decisions.
- **Execution Agents:**
    - **Claude Code:** Primary executing coding agent. Follows strict Read -> Plan -> Implement -> Verify workflow.
    - **Codex (GPT-5.5/5.4):** Secondary execution agent for multi-file refactoring and general development.
    - **Native Models (Nano Banana Pro 2, Gemini 2.5 Pro UI):** Specialized for asset generation and UI/Visual verification.

## 2. Standardized Operational Workflows
All agents must adhere to the following chronological sequences:

### A. Development Sequence (Claude/Codex)
1. **Explore:** Inspect files and context without modification.
2. **Plan:** Propose concrete changes, assess risks, and wait for Architect/Human approval.
3. **Implement:** Apply changes following established patterns (AGENTS.md, CLAUDE.md).
4. **Verify:** Run tests (29/29 stable), lint, and build.

### B. UI/Visual Verification (Native/Subagents)
- No UI task is considered complete without visual evidence (screenshots/recordings).
- Uses Gemini 2.5 Pro UI Checkpoint (Browser Subagent) for validation.

## 3. Architecture & Guardrails
- **Authority Files:** `CLAUDE.md` (Rules), `AGENTS.md` (Protocols), `GEMINI.md` (Global).
- **Safety Measures:** Deterministic hooks (block-dangerous-commands.sh) intercept destructive actions (e.g., forced pushes).
- **Tooling:** MCP servers are strictly for external documentation and project management (Jira/GitHub) integration.

## 4. Model Routing Table
| Task Type | Recommended Model |
| :--- | :--- |
| Complex Refactoring | GPT-5.5 / Gemini 3.1 Pro High |
| General Development | GPT-5.4 / Claude 3.5 Sonnet |
| Lightweight Subagents | GPT-5.4-mini / Gemini 3 Flash |
| Image/Asset Gen | Nano Banana Pro 2 |
| UI/Visual Testing | Gemini 2.5 Pro UI Checkpoint |

---

## Intervención: LAW-03 Combat UI Refactor
**Fecha:** 2026-05-04
**Agente:** Claude Code (Sonnet 4.6)
**Commits:** `f616396`, `47ee4e9`
**Archivos tocados:** `app/campaign/[id]/ActionInput.tsx`, `components/combat/CombatHUDController.tsx`

### Diagnóstico previo
Se realizó una exploración completa de los tres archivos del context pack:

| Archivo | Hallazgo | Veredicto |
|---------|----------|-----------|
| `CombatHUDController.tsx` | HP updates ya iteran `targets[]` vía `applyCombatTargetsToCombatants()` | ✅ LAW-03 conforme |
| `CombatHUDController.tsx` | SSE `COMBAT_CONSEQUENCE` usa `hpAfter` del backend — sin predicciones | ✅ Feedback determinista |
| `CombatHUDController.tsx` | Cast `as unknown as CombatConsequencePayload` en línea 88 | ❌ Riesgo de type safety |
| `ActionInput.tsx` | `PendingActionPayload` y `RemoteActionPayload` idénticas (líneas 37–45) | ❌ Duplicación |
| `ActionInput.tsx` | `targetIds` siempre normalizado a `string[]` antes del fetch | ✅ Contrato conforme |
| `lib/events/game-events.ts` | `CombatConsequencePayload.targets: SingleTargetConsequence[]` correcto | ✅ Sin cambios |

### Cambios aplicados

#### 1. `ActionInput.tsx` — Unificación de interfaces (commit `f616396`)
- **Eliminado:** `PendingActionPayload` e `RemoteActionPayload` (estructuralmente idénticas)
- **Añadido:** `ActionPayload { action: string; targetIds?: string[] }`
- **Actualizado:** `executeAction(payload: ActionPayload)` y `CustomEvent<ActionPayload>`
- **Motivación:** El Contrato de Intenciones (LAW-03) exige un único tipo canónico para el payload de acción del jugador.

#### 2. `CombatHUDController.tsx` — Type guard (commit `47ee4e9`)
- **Eliminado:** `const payload = frame.e.payload as unknown as CombatConsequencePayload` — el doble cast bypasseaba el type checker completamente.
- **Añadido:** Función pura `isCombatConsequencePayload(p: Record<string, unknown>): p is CombatConsequencePayload` que valida `Array.isArray(p.targets)`.
- **Comportamiento nuevo:** Si el payload del SSE no pasa el guard, el handler falla silenciosamente (no crash, no estado corrupto).
- **Motivación:** Alinear la frontera de tipos con el Feedback Determinista — la UI nunca debe procesar un payload mal formado como si fuera válido.

### Decisión de diseño documentada
Los botones F1–F12 del `CombatHUD` (Attack, Dash, Cast Spell, etc.) **no envían `targetIds`** en el fetch de `CombatHUDController`. Esto es intencional: son macros contextuales sin UI de selección de objetivos. La selección explícita de targets vive en `ActionInput`. El backend/AI infiere el objetivo del contexto del encuentro. Si en el futuro se requiere targeting en macros HUD, se deberá añadir UI de selección dentro de `CombatHUD` y actualizar el prop `onActionTrigger: (action: string) => void` para incluir `targetIds`.

### Verificación
- `pnpm exec tsc --noEmit` → 0 errores (ejecutado tras cada commit)
- `pnpm lint` → pendiente de ejecución en siguiente sesión
- Tests manuales SSE → pendiente de validación con dev server activo
