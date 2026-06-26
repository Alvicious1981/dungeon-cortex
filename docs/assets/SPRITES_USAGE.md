# Uso de sprites de equipo en Dungeon Cortex

Este documento explica cómo usar el pack inicial de sprites gráficos sin tocar reglas, combate, backend, Prisma ni estado de juego.

## Archivos añadidos

```text
public/assets/sprites/equipment/equipment-spritesheet.svg
public/assets/sprites/equipment/equipment-manifest.json
```

## Qué contiene

El spritesheet incluye 24 sprites de equipo:

- Armas: espada, daga, hacha, martillo, arco, bastón, lanza y ballesta.
- Armaduras: cascos, coraza, botas, guanteletes, escudos y capa.
- Objetos: pociones, pergamino, llave, bolsa de monedas, antorcha, libro y gema.

## Ruta pública en Next.js

Los archivos colocados dentro de `public/` se pueden usar desde la raíz pública del sitio.

Ejemplo:

```tsx
<img
  src="/assets/sprites/equipment/equipment-spritesheet.svg"
  alt="Dungeon Cortex equipment sprites"
  width={384}
  height={256}
/>
```

## Uso recomendado para V0

Para una primera integración visual, usa el spritesheet como imagen completa o úsalo como referencia para asignar iconos a objetos de inventario.

No hace falta instalar librerías ni modificar reglas.

## Uso con el manifest

El archivo `equipment-manifest.json` incluye:

- `id`: identificador estable del sprite.
- `name`: nombre legible.
- `category`: `weapon`, `armor` o `item`.
- `frame`: coordenadas dentro del spritesheet.

Ejemplo conceptual:

```tsx
const sword = manifest.sprites.find((sprite) => sprite.id === "iron_sword");
```

## Recomendación para Claude Code o Codex

Primero comprobar que la ruta existe abriendo:

```text
http://localhost:3000/assets/sprites/equipment/equipment-spritesheet.svg
```

Si se ve una cuadrícula de iconos, el asset está funcionando.

Después, si ya existe una pantalla de inventario/equipo, se pueden mostrar los iconos. Si no existe, no conviene crear un sistema nuevo solo para esto.

## Límites de esta tarea

Esta tarea solo añade assets y documentación.

No modifica:

- reglas,
- combate,
- eventos,
- IA narrativa,
- backend,
- base de datos,
- Prisma,
- `.env`,
- dependencias,
- lockfiles.
