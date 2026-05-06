# AGENT LOG — DUNGEON CORTEX

Registro canónico de intervenciones técnicas. Cada entrada documenta exactamente qué se hizo, qué archivos se tocaron y cómo validar el resultado. No crear archivos con fechas en el título — editar siempre este archivo.

---

## INTERVENCIÓN: Priority 7 — BSP Dungeon Generator (rot.js)

**Fecha:** 2026-05-06  
**Etiqueta:** PRIORITY-7-BSP  
**Estado final:** ✅ COMPLETADO — 1550/1550 tests en verde, 0 errores TypeScript  

---

### Motivación

`lib/rules/exploration.ts` y `lib/rules/exploration-logic.ts` ya implementaban la lógica de tiempo y el grafo de nodos de mazmorra, pero sin representación visual de tiles. Los `LocationNode.x/y` se asignaban con coordenadas arbitrarias (rango 0–5). El objetivo era integrar `rot.js` como generador BSP para producir un mapa de tiles real, usable tanto en el cliente (renderizado visual) como en el servidor (validación de movimiento/FOV), sin almacenar tiles en la DB.

**Decisión de arquitectura clave:** el grid de tiles se genera en ambos entornos a partir del `Location.seed` existente. Se mantiene la determinismo: mismo seed → mismo dungeon siempre. No hay nueva migración de Prisma.

---

### Archivos creados

| Archivo | Responsabilidad |
|---------|-----------------|
| `lib/rules/dungeon.ts` | Servicio BSP isomorfo: `generateDungeon`, `getTile`, `computeFOV`, `hasLineOfSight` |
| `lib/hooks/useDungeon.ts` | Hook React: genera dungeon + FOV desde seed, memoizado |
| `components/exploration/DungeonMapVTT.tsx` | Renderer SVG con pan/zoom, fog of war, tokens de sala y jugador |
| `tests/rules/dungeon.test.ts` | 13 tests unitarios (TDD, todos verdes) |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `lib/rules/exploration-logic.ts` | `generateLocationPayload` acepta `options.dungeonMap` opcional; nodos de tipo "dungeon" reciben coordenadas escaladas desde centros BSP |
| `lib/ai/tools/exploration.ts` | `generateLocation` genera `dungeonMap` y lo pasa a `generateLocationPayload` cuando `locationType === "dungeon"` |
| `app/campaign/[id]/page.tsx` | Añade `DungeonMapVTT` condicional cuando `location.type === "dungeon"` con contenedor `h-96` |
| `package.json` / `pnpm-lock.yaml` | Añade `rot-js@2.2.1` |
| `tsconfig.json` | Añade `"types": ["vitest/globals"]` para reconocimiento de globals en tests |

---

### Diseño del módulo `lib/rules/dungeon.ts`

```typescript
// Tipos exportados
export type TileType = "wall" | "floor" | "door"

export interface DungeonRoom {
  id: number       // índice BSP (0-based)
  x, y             // esquina superior izquierda
  width, height    // dimensiones
  centerX, centerY // centro del room
  nodeIndex        // mapea a LocationNode.index
}

export interface DungeonMap {
  seed, width, height
  tiles: TileType[][]              // [y][x], row-major
  rooms: DungeonRoom[]
  corridors: { fromRoomId, toRoomId }[]
  modifications?: Record<string, TileType>  // overrides futuros del DM
}
```

**Seed → entero (FNV-1a 32-bit):** `seedToInt(seed)` → `ROT.RNG.setSeed()` → `new ROT.Map.Digger()`.

**Advertencia de concurrencia (riesgo documentado):** `ROT.RNG` es estado global. En el servidor, llamadas concurrentes pueden corromper el seed de cada una. Mitigación a corto plazo: la generación es síncrona y rápida (~2ms); a medio plazo usar `ROT.RNG.clone()` por llamada.

**Atribución de corredores:** se usa containment check (`px >= room.x && px < room.x + room.width`) antes del fallback por distancia Manhattan. Necesario porque para rooms grandes (hasta 12×9 tiles) el endpoint del corredor puede estar más lejos del centro de su propio room que del centro de un room vecino.

**FOV:** `RecursiveShadowcasting` (no `PreciseShadowcasting`, que puede retornar tiles a `radius*√2` rompiendo la garantía de radio). Se añade `visible.add(`${originX},${originY}`)` post-compute para garantizar que el tile de origen siempre sea visible incluso si el jugador está en un tile de pared por bug.

**LOS:** Bresenham line, detiene al primer tile "wall".

---

### Bridge BSP → LocationNode

`generateLocationPayload(input, { dungeonMap })` en `exploration-logic.ts`:

```typescript
x: room ? Math.round((room.centerX / (width - 1)) * 5) : node.x
y: room ? Math.round((room.centerY / (height - 1)) * 5) : node.y
```

Escala coordenadas de tile (0..79) al rango 0–5 que usa `LocationNode`. Los nodos sin room correspondiente (si BSP genera menos rooms que `nodeCount`) conservan sus coordenadas originales.

---

### Hook `lib/hooks/useDungeon.ts`

```typescript
export function useDungeon(
  seed: string | null,   // null → dungeon: null
  playerX: number,
  playerY: number,
  options?: { width?, height?, nodeCount? }
): { dungeon: DungeonMap | null; fov: Set<string>; isReady: boolean }
```

- `useMemo` para dungeon (deps: seed + options dimensions)
- `useMemo` para FOV (deps: dungeon + playerX + playerY)
- Guard: `seed === null` (strict, no falsy — evita tratar `""` como ausencia)

---

### Componente `DungeonMapVTT`

Sigue el patrón exacto de `WildernessMapVTT` (pointer capture drag + wheel zoom):

- SVG puro, sin Canvas
- `TILE_COLORS` y `TILE_SIZE = 16` a nivel de módulo (no en render)
- Tiles de pared invisibles (no en FOV) → no se renderizan (optimización)
- Tiles visitados pero fuera de FOV → opacidad 0.45
- Marcadores de sala: amber (activo) / dark-amber (visitado) / dark-brown (en FOV, no visitado)
- Room activo: anillo punteado adicional
- Token del jugador: azul `#1e40af` / `#93c5fd`
- Botones: "1:1" (reset zoom) y "Center" (centra en jugador)
- `touchAction: "none"` en SVG para soporte móvil

---

### Integración en `app/campaign/[id]/page.tsx`

```tsx
const dungeonCurrentNode =
  explorationData?.location.type === "dungeon" && explorationData.location.seed
    ? (explorationData.nodes.find(n => n.index === explorationData!.initialCurrentNodeIndex) ?? null)
    : null

{dungeonCurrentNode && explorationData && (
  <div className="w-full h-96">
    <DungeonMapVTT
      seed={explorationData.location.seed}
      playerX={dungeonCurrentNode.x}
      playerY={dungeonCurrentNode.y}
      currentNodeIndex={explorationData.initialCurrentNodeIndex}
      visitedNodeIndices={explorationData.initialVisitedNodeIndices}
    />
  </div>
)}
```

---

### Commits

| Hash | Mensaje |
|------|---------|
| `f418bf7` | feat(dungeon): implement isomorphic BSP dungeon generator with rot.js |
| `001d147` | fix(dungeon): guarantee FOV origin tile always in visible set |
| `99c8e5a` | fix(dungeon): use room containment for corridor attribution; clean comment hygiene |
| `0db97ce` | test(dungeon): add failing tests for BSP generator + type stubs |
| `501d926` | test(dungeon): fix DungeonTile removal, strengthen hasLineOfSight test, loosen nodeIndex check |
| `505dc2a` | feat(dungeon): bridge BSP room centers to LocationNode x/y positions |
| `c4207b8` | feat(dungeon): add useDungeon hook for client-side tile grid + FOV |
| `180c05f` | fix(dungeon): guard useDungeon seed with strict null check |
| `08afc52` | feat(dungeon): add DungeonMapVTT SVG tile renderer with pan/zoom and FOV |
| `0d203e9` | refactor(dungeon): fix comment hygiene, hoist tileColors constant, convert to function declaration |
| `ebcc718` | feat(dungeon): render DungeonMapVTT in campaign page for dungeon locations |
| `285bef8` | fix(dungeon): replace IIFE pattern with pre-computed node; add height container for DungeonMapVTT |

---

### Checklist de 11 Puntos (DoD)

| Punto | Estado | Nota |
|-------|--------|------|
| Contrato Zod | ✅ | No aplica directamente — `generateDungeon` es pura, no recibe input de red |
| Migración DB | ✅ | No aplica — seed ya existía, tiles no se persisten |
| Función Pura | ✅ | `lib/rules/dungeon.ts` es 100% puro, sin side effects |
| Test Unitario | ✅ | 13 tests en `tests/rules/dungeon.test.ts`, todos verdes |
| Test Integración | ✅ | No aplica — no escribe en DB |
| Evento Persistente | ✅ | No aplica — componente visual read-only |
| Canon | ✅ | `srd_anchor`: las reglas de FOV y LOS son mecánicas puras, no narrativas |
| Feedback Visual | ✅ | `DungeonMapVTT` refleja posición, FOV y estado de sala en tiempo real |
| Auditoría de Rechazo | ✅ | `getTile` retorna `"wall"` para coords fuera de rango; seed null → dungeon null |
| Prompt Mantenimiento | ✅ | Este archivo |
| Rollback | ✅ | Eliminar los 12 commits o revertir `exploration-logic.ts` y `exploration.ts` restora el estado anterior |

---

### Validación

```bash
pnpm test          # 1550/1550 tests green
pnpm exec tsc --noEmit  # 0 errores TypeScript
pnpm dev           # navegar a campaign con dungeon → DungeonMapVTT visible
```

---
