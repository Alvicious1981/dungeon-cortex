---
page: campaign-library-768
device: tablet-portrait
source_screen: bd8ff41eed88407fbff63077466592c8
---

Adapta la pantalla de producción aprobada `bd8ff41eed88407fbff63077466592c8` a 768 × 1024.

Conserva su identidad, contenido, estados y jerarquía. Esta tarea es exclusivamente responsive: no añadas funciones, campos, navegación global, campañas, personajes ni datos mecánicos.

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

## Contenido que debe conservarse

- Marca “Dungeon Cortex”, título “Biblioteca de campañas” y enlace “Volver al inicio” con destino `/`.
- Banner “Conexión interrumpida. Reintentaremos cuando vuelva la conexión.” y acción “Reintentar”.
- Lista “Tus campañas” con tarjeta seleccionada, estado no disponible y skeleton.
- Solo los campos “Nombre de campaña”, “Personaje”, “Última actividad”, “Nombre”, “Personaje vinculado”, “Última actividad” y “Resumen disponible”.
- Todos los valores de datos deben seguir siendo “Dato disponible al conectar”.
- Acciones “Crear campaña” y “Continuar campaña”; esta última debe permanecer deshabilitada sin identificador del servidor.

## Estructura a 768 × 1024

1. Usa una sola columna en este orden: cabecera, banner, lista de campañas y detalle seleccionado.
2. Permite que la cabecera y el banner distribuyan su contenido en varias líneas cuando sea necesario; conserva todos los textos y acciones.
3. No uses sidebar, pestañas, posición fija ni paneles pegajosos.
4. Mantén entre 20 y 24 px de padding lateral y una separación mínima de 8 px entre controles contiguos.
5. Las acciones del detalle pueden ocupar todo el ancho disponible y apilarse para mantener targets de al menos 44 × 44 px.
6. Reduce espaciado antes que tipografía. El texto funcional no puede bajar de 14 px ni las etiquetas de 12 px.
7. El fondo nocturno debe cubrir todo el viewport y no debe existir overflow horizontal.

## Estados que deben representarse

- Seleccionado mediante texto/estructura además del color y con un único control semántico `button` que use `aria-pressed`.
- Carga mediante skeleton estático, sin animación decorativa.
- Error recuperable mediante “Campaña no disponible” y “Reintentar”.
- Conexión perdida mediante el banner textual.
- Acción no disponible mediante estado deshabilitado y nombre accesible.

## Restricciones funcionales y accesibles

- Esta generación es una propuesta visual, no una implementación.
- No presupongas que `GET /api/campaign` ya existe.
- No calcules ni infieras estados, fechas, acciones legales o valores mecánicos en el cliente.
- No uses nombres propios, datos ficticios, ilustraciones ni textos promocionales.
- No uses `href="#"`, controles basados en `div` ni targets menores de 44 × 44 px.
- “Volver al inicio” debe conservar `href="/"`.
- Mantén foco visible `#8dd7ff`, orden de teclado lógico, landmarks y nombres accesibles.
- Conserva `<meta name="viewport" content="width=device-width, initial-scale=1.0">` sin `maximum-scale` ni `user-scalable=no`.
- Respeta `prefers-reduced-motion`; el skeleton debe permanecer estático.
- No cambies el design system ni introduzcas librerías o assets.
