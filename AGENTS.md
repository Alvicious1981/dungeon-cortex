# AGENTS.md - Dungeon Cortex Codex Instructions

## 1. Canon de Dungeon Cortex

- Dungeon Cortex usa exclusivamente D&D 5e/SRD 2014.
- `dnd5eapi.co` es la fuente primaria de reglas y datos SRD.
- El backend es autoritativo para legalidad, tiradas, DCs, dano, recursos, condiciones, estado y persistencia.
- La IA solo puede narrar hechos ya resueltos por el backend.
- Esta prohibido introducir AD&D, OSR, THAC0, AC descendente, salvaciones retro, moral OSR o XP por oro.

## 2. Reglas de edicion

- No tocar reglas, combate, eventos ni pipeline salvo que la tarea lo autorice explicitamente.
- No modificar `.env`, secretos, configuracion de despliegue ni base de datos.
- No instalar dependencias sin autorizacion explicita.
- No abrir PR ni hacer commits salvo autorizacion explicita.
- No modificar lockfiles salvo que la tarea autorice explicitamente instalar, actualizar o retirar dependencias.

## 3. Gestor de paquetes

- Usar el gestor detectado en el repo.
- Si existe `pnpm-lock.yaml`, usar `pnpm`.
- No mezclar `npm`, `yarn`, `pnpm` o `bun`.

## 4. Comandos seguros de verificacion

Antes de ejecutar scripts, Codex debe comprobar `package.json` para confirmar que existen.

- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `pnpm run check-retro`

## 5. Comandos prohibidos salvo autorizacion explicita

- `rm -rf`
- `git reset --hard`
- `git clean -fdx`
- Borrar carpetas completas.
- Modificar `.env` o secretos.
- Instalar, actualizar o retirar dependencias.
- Ejecutar migraciones Prisma.
- Cambiar configuracion de despliegue.
- Ejecutar seeds o scripts que modifiquen base de datos.

## 6. Politica para integrar nuevas librerias

Cada nueva libreria debe integrarse en una tarea separada. Cada tarea debe indicar:

- dependencia exacta;
- archivos afectados;
- tests;
- comandos de verificacion;
- rollback;
- riesgos.

No se debe instalar ninguna libreria si la tarea no autoriza expresamente esa integracion.

## 7. Orden recomendado de integraciones

1. MSW
2. ts-pattern
3. TanStack Query
4. Playwright
5. Promptfoo

## 8. Reglas de revision

Al finalizar cada tarea, Codex debe entregar:

- archivos creados o modificados;
- resultado de `git status --short`;
- resultado de `git diff --stat`;
- comandos ejecutados;
- resultado de los comandos;
- riesgos pendientes;
- confirmacion de que no toco archivos prohibidos.
