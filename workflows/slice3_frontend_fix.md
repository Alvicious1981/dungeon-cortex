# ARTEFACTO ANTIGRAVITY: FRONTEND FIX (SLICE 3)

## 1. Directivas de Intervención
- **Objetivo:** Restaurar la inferencia determinista del AST en `app/campaign/[id]/page.tsx`.
- **Vector:** Eliminación de la clave de inclusión obsoleta `encounterMap`.

## 2. Parche de Código Base
Aplicar la siguiente mutación estructural en `app/campaign/[id]/page.tsx`:

```typescript
// BUSCAR (Líneas ~191-196):
        encounters: {
          where: { status: "active" },
          include: {
            combatants: { orderBy: { initiativeTotal: "desc" } },
            encounterMap: true,
          },
        },

// REEMPLAZAR POR (Eliminar encounterMap):
        encounters: {
          where: { status: "active" },
          include: {
            combatants: { orderBy: { initiativeTotal: "desc" } },
          },
        },
3. Secuencia de Validación Autónoma
Ejecutar verificación de integridad post-parche para asegurar que las proyecciones relacionales han sido reconstruidas por el compilador:

// turbo
pnpm exec tsc --noEmit