---
page: campaign-library-1024
device: tablet-landscape
source_screen: 5477968ff817486dbc4f024a36ed67c5
---

Adapta la pantalla de producción aprobada `5477968ff817486dbc4f024a36ed67c5` a 1024 × 768.

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

## Estructura

1. Mantén la cabecera y el banner compactos, sin sidebar ni pestañas.
2. Conserva lista y detalle en dos columnas si ambos paneles mantienen al menos 320 px útiles; en caso contrario, apílalos.
3. Reduce espaciado antes que tipografía. El texto funcional no puede bajar de 14 px ni las etiquetas de 12 px.
4. Mantén visibles las acciones principales sin usar posición fija.
5. El fondo nocturno debe cubrir todo el viewport y no debe existir overflow horizontal.

## Estados que deben representarse

- Seleccionado mediante texto/estructura además del color.
- Carga mediante skeleton estático o compatible con `prefers-reduced-motion`.
- Error recuperable mediante “Campaña no disponible” y “Reintentar”.
- Conexión perdida mediante el banner textual.
- Acción no disponible mediante estado deshabilitado y nombre accesible.

## Restricciones funcionales

- Esta generación es una propuesta visual, no una implementación.
- No presupongas que `GET /api/campaign` ya existe.
- No calcules ni infieras estados, fechas, acciones legales o valores mecánicos en el cliente.
- No uses nombres propios, datos ficticios, ilustraciones ni textos promocionales.
- No uses `href="#"`, controles basados en `div` ni targets menores de 44 × 44 px.
- Mantén foco visible, orden de teclado lógico, landmarks y nombres accesibles.
- No cambies el design system ni introduzcas librerías o assets.
