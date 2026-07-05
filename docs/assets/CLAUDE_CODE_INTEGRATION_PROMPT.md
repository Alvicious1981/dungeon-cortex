# Prompt para Claude Code / Codex

Copia este prompt en una sesión nueva si quieres que el agente integre visualmente los sprites en una pantalla existente.

```text
Actúa como desarrollador senior de Next.js/React para el repositorio Dungeon Cortex.

Objetivo:
Integrar de forma segura el pack de sprites de equipo ya añadido al repositorio.

Archivos disponibles:
- public/assets/sprites/equipment/equipment-spritesheet.svg
- public/assets/sprites/equipment/equipment-manifest.json
- docs/assets/SPRITES_USAGE.md

Reglas obligatorias:
- No modificar reglas, combate, eventos, backend, base de datos, Prisma, .env ni secretos.
- No instalar dependencias.
- No tocar lockfiles.
- No cambiar lógica de juego.
- Solo integrar assets gráficos.
- Si existe una pantalla de inventario/equipo, preparar un uso visual mínimo.
- Si no existe pantalla de inventario/equipo, no crear un sistema nuevo grande: solo documentar cómo usar los assets.

Pasos:
1. Revisa la estructura del proyecto.
2. Comprueba que el spritesheet se sirve desde `/assets/sprites/equipment/equipment-spritesheet.svg`.
3. Si hay componente de inventario/equipo, muestra iconos usando el manifest, sin cambiar reglas.
4. Si no hay componente adecuado, no inventes una pantalla grande nueva.
5. Ejecuta solo los comandos seguros disponibles en package.json:
   - pnpm typecheck
   - pnpm test
   - pnpm lint, solo si funciona en este proyecto
6. Entrega:
   - archivos creados o modificados,
   - git status --short,
   - git diff --stat,
   - comandos ejecutados,
   - resultado de cada comando,
   - riesgos pendientes,
   - confirmación de que no tocaste archivos prohibidos.
```

## Modelo recomendado

Para esta tarea basta un modelo económico/rápido, porque solo debe revisar rutas y tocar UI superficial. Usa un modelo más potente únicamente si decides construir una pantalla completa de inventario/equipo.
