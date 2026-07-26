# Dungeon Cortex — Sistema de diseño para Stitch

Estado: aprobado para el ciclo manual de diseño
Autoridad de producto: `Dungeon_Cortex_Optimized_UI_Architecture_Guide.md`
Autoridad ejecutable: `docs/DESIGN.md` y `app/globals.css`

Stitch sirve para explorar composición y jerarquía. No es autoridad de reglas, contratos, contenido narrativo ni assets finales.

## 1. Principios

1. La narración ocupa la superficie más calmada y legible.
2. La información mecánica confirmada utiliza geometría precisa, etiquetas explícitas y numerales claros.
3. Las acciones disponibles se distinguen de la narración y del estado mecánico.
4. Un único acento cálido identifica la acción primaria.
5. Tres niveles de superficie son suficientes; el ornamento nunca compite con la lectura.
6. La interfaz debe funcionar sin ilustraciones.

## 2. Tokens

| Rol | Valor |
| --- | --- |
| Lienzo | `#0b0d10` |
| Superficie | `#12161b` |
| Superficie elevada | `#192029` |
| Borde | `#34404d` |
| Texto | `#f2ebdd` |
| Texto secundario | `#b6bec8` |
| Acción | `#d78a3a` |
| Narración | `#d6c7a1` |
| Mecánica | `#8bb8e8` |
| Éxito | `#55c38a` |
| Advertencia | `#e7b85c` |
| Error | `#ee6b73` |
| Foco | `#8dd7ff` |

## 3. Tipografía

- Stitch usa `Source Serif 4` para encabezados y `Inter` para cuerpo y etiquetas como aproximaciones visuales.
- El producto no importará esas fuentes: React conserva Georgia y la pila sans-serif del sistema.
- El cuerpo y los controles parten de 16 px.
- Los valores mecánicos usan numerales tabulares o una pila monoespaciada.
- Las mayúsculas con tracking amplio se reservan para etiquetas breves.

## 4. Geometría, accesibilidad y movimiento

- Escala espacial base de 4 px.
- Targets interactivos mínimos de 44 × 44 px.
- Radio principal de 8 px; se permiten 4, 12 y 16 px según jerarquía.
- Foco visible con contraste suficiente.
- Ningún estado depende solo del color.
- Las interfaces deben contemplar carga, vacío, error, pérdida de conexión y acción no disponible.
- Movimiento breve de 140–220 ms; `prefers-reduced-motion` elimina el movimiento decorativo.

## 5. Límites de contenido

- Usar únicamente la marca Dungeon Cortex.
- No reutilizar marcas D&D, Forgotten Realms, personajes, campañas, textos o imágenes del proyecto fuente.
- No introducir clases, subclases, talentos, hechizos, precios, daño, atributos o reglas no confirmadas por el backend.
- No representar una acción como válida o resuelta antes de recibir la respuesta autoritativa.
- Los assets de Stitch son conceptuales y requieren revisión de procedencia antes de incorporarse.

## 6. Design System Notes for Stitch Generation

**DESIGN SYSTEM (REQUIRED):**

- Product name: Dungeon Cortex. Spanish interface with a sober, clear and evocative voice.
- Direction: nocturnal editorial archive; calm reading surfaces, restrained atmosphere and no ornamental clutter.
- Canvas `#0b0d10`; surface `#12161b`; raised surface `#192029`; border `#34404d`.
- Primary text `#f2ebdd`; secondary text `#b6bec8`; warm action accent `#d78a3a`.
- Narrative accent `#d6c7a1`; confirmed mechanical information `#8bb8e8`; focus `#8dd7ff`.
- Source Serif 4 headings and Inter UI text are Stitch-only proxies for Georgia and the product system font stack.
- Use at most three surface levels, 8 px primary radius, 4 px spacing scale and 44 px minimum interactive targets.
- Separate narration, confirmed mechanics and available actions through labels and structure, never through color alone.
- Provide visible focus, keyboard-logical order, loading, empty, error, disconnected and unavailable states.
- The interface must work without illustrations. Do not generate or depend on fantasy artwork for comprehension.
- Do not use D&D, Forgotten Realms or source-project branding, characters, campaigns, copy or images.
- Do not invent rules, legal actions, classes, damage, prices, resources or consequences. The backend is authoritative.
- Desktop target is 1440 × 900. The composition must remain adaptable to 1024 × 768, 768 × 1024 and 390 × 844 without horizontal document overflow.
