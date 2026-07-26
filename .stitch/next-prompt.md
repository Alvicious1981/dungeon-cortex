---
page: campaign-library
device: desktop
source_screen: c31196fa0ee04ca8bbf943c7e636b0c3
---

Diseña la biblioteca de campañas de Dungeon Cortex para escritorio a 1440 × 900.

Toma de la pantalla fuente únicamente la idea de una lista de campañas con un panel de detalle. No copies su marca, imágenes, personajes, campañas, textos promocionales ni datos mecánicos.

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

## Datos permitidos

Cada campaña puede mostrar exclusivamente:

- `id`;
- `title`;
- `status`;
- `updatedAt`;
- `character.name`;
- `character.class`;
- `character.level`.

No mostrar tiempo jugado, dificultad, party, misión activa, localización, thumbnail narrativo o peligro. Esos datos no tienen todavía un contrato de listado autoritativo.

## Estructura

1. Cabecera compacta con marca Dungeon Cortex, título “Tus campañas” y acceso secundario para volver al inicio.
2. Introducción breve que explique que se puede continuar una campaña existente.
3. Lista navegable de campañas a la izquierda o en la zona principal.
4. Panel de detalle para la campaña seleccionada, limitado a los datos permitidos.
5. Acción primaria “Continuar campaña”.
6. Acción secundaria que dirija al flujo existente “Crear personaje”.
7. Sin imágenes obligatorias; usar superficies, iniciales o geometría CSS si hace falta identificar elementos.

## Estados que deben representarse

- Carga mediante skeletons con dimensiones estables.
- Vacío con explicación y acción “Crear personaje”.
- Error recuperable con acción “Reintentar”.
- Sesión no autenticada con mensaje claro y acción de acceso.
- Conexión perdida o degradada mediante banner textual.
- Campaña no disponible o no activa con motivo visible y acción deshabilitada.

## Restricciones funcionales

- Esta generación es una propuesta visual, no una implementación.
- No presupongas que `GET /api/campaign` ya existe.
- No calcules ni infieras estados, fechas relativas o acciones legales en el cliente.
- “Continuar campaña” solo representa navegación futura a `/campaign/{id}`.
- Usa texto de muestra neutral y claramente ficticio, sin presentar reglas o resultados mecánicos.
