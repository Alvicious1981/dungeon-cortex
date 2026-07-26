# Dungeon Cortex — Sistema de diseño

Estado: Propuesta aprobada para implementación
Dirección: archivo nocturno editorial

La guía maestra exige una fuente versionada de tokens, pero no prescribe una identidad visual concreta. Esta dirección se adopta como decisión de producto para el hito y no se presenta como regla original de la guía.

## 1. Principios visuales

1. **La lectura primero.** La narración ocupa la superficie más calmada y legible.
2. **Mecánica verificable.** Datos y resultados usan geometría más precisa, numerales tabulares y color informativo.
3. **Inmersión contenida.** La atmósfera procede de capas, textura muy sutil y tipografía editorial; no de ornamento que compita con controles.
4. **Acción inequívoca.** Un único acento cálido identifica acciones primarias.
5. **Profundidad limitada.** Tres niveles de superficie bastan para expresar jerarquía.

## 2. Tokens

Los valores ejecutables viven en `app/globals.css`. Los nombres son semánticos:

| Rol | Token | Valor inicial |
| --- | --- | --- |
| Lienzo | `--dc-canvas` | `#0b0d10` |
| Superficie | `--dc-surface` | `#12161b` |
| Superficie elevada | `--dc-surface-raised` | `#192029` |
| Borde | `--dc-border` | `#34404d` |
| Texto | `--dc-text` | `#f2ebdd` |
| Texto secundario | `--dc-text-muted` | `#b6bec8` |
| Acción | `--dc-action` | `#d78a3a` |
| Narración | `--dc-narrative` | `#d6c7a1` |
| Mecánica | `--dc-mechanical` | `#8bb8e8` |
| Éxito | `--dc-success` | `#55c38a` |
| Advertencia | `--dc-warning` | `#e7b85c` |
| Error | `--dc-error` | `#ee6b73` |
| Información | `--dc-info` | `#79b8e8` |
| Foco | `--dc-focus` | `#8dd7ff` |
| Selección | `--dc-selection` | `#284965` |

## 3. Tipografía

- Interfaz y cuerpo: pila del sistema (`Segoe UI`, Arial y sans-serif).
- Encabezados editoriales: Georgia con fallback a serif del sistema.
- Valores mecánicos: Consolas con fallback a monospace del sistema.
- Tamaño mínimo de cuerpo: 16 px en superficies narrativas y formularios.
- Interlineado narrativo: 1.7–1.8.
- Mayúsculas y tracking amplio solo para etiquetas breves.

No se añade ni descarga ninguna fuente externa.

## 4. Geometría

- Escala espacial base: 4 px.
- Targets interactivos: mínimo 44 px.
- Radios: 4, 8, 12 y 16 px; los paneles principales usan 12 px.
- Ancho de lectura narrativa: 68–72 caracteres.
- Sombras: una sombra ambiental y un borde; nunca comunican estado por sí solos.
- Breakpoints: se utilizan los breakpoints existentes de Tailwind y se validan en 390, 768, 1024 y 1440 px.

## 5. Componentes

Botones, campos, enlaces, paneles y mensajes comparten los estados:

- `default`;
- `hover`;
- `active`;
- `focus-visible`;
- `disabled`;
- `loading`;
- `selected`, cuando aplica;
- `error`, asociado mediante texto.

Los paneles narrativos y mecánicos se distinguen por etiqueta, estructura y color, nunca solo por color.

## 6. Movimiento

- Duración breve: 140 ms.
- Duración media: 220 ms.
- Easing: salida suave para aparición; estándar para cambios de control.
- Solo se animan `transform` y `opacity` cuando sea viable.
- No se usan parallax, sacudidas continuas, texto animado ni transiciones que retrasen datos.
- `prefers-reduced-motion: reduce` elimina todo movimiento no esencial.

## 7. Assets

El sistema debe funcionar sin ilustraciones. Los fondos e ilustraciones futuros:

- serán originales y tendrán procedencia registrada;
- utilizarán WebP o AVIF para raster y SVG/CSS para geometría simple;
- incluirán variantes responsive cuando aporten información;
- serán decorativos con `alt=""` cuando no comuniquen contenido;
- requerirán revisión humana de legibilidad, licencia y coherencia.

Los assets visuales existentes no son autoridad de diseño para este hito.
