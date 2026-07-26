# Dungeon Cortex — Especificación de interfaz

Estado: Aprobada para el nuevo hito de frontend
Fuente principal: `Dungeon_Cortex_Optimized_UI_Architecture_Guide.md`
Alcance: presentación, navegación, interacción, estados y calidad de interfaz

## 1. Objetivo del producto

Dungeon Cortex es una experiencia individual de Director de Mazmorras asistido por IA. La interfaz debe permitir crear un personaje, abrir una campaña y declarar intenciones con rapidez, mostrando siempre por separado:

- narración;
- hechos mecánicos confirmados por el backend;
- acciones disponibles;
- estado y feedback del sistema.

La interfaz no resuelve reglas, tiradas, daño, legalidad ni persistencia.

## 2. Prioridades

### P0

1. Portada y acceso al flujo jugable.
2. Creación de personaje.
3. Apertura y carga de campaña.
4. Bitácora narrativa y entrada de intención.
5. Estado básico del personaje.
6. Exploración y combate ya respaldados por el backend.
7. Estados de carga, vacío, error y pérdida de conexión.

### P1

1. Inventario y equipo en vista de lista.
2. Diario, misiones y PNJ.
3. Navegación móvil consolidada.
4. Endurecimiento responsive y de accesibilidad.

### P2

1. Edición espacial del inventario.
2. Profundidad de mapas y efectos audiovisuales.
3. Producción final de ilustraciones y texturas.

## 3. Arquitectura de información

El shell de campaña se organiza en cuatro superficies:

1. **Bitácora:** narración, eventos mecánicos e intención del jugador. Es la superficie prioritaria en móvil.
2. **Resumen:** puntos de golpe, condiciones y recursos confirmados.
3. **Contexto:** escena, acciones disponibles, exploración o combate.
4. **Archivo:** inventario, misiones, PNJ, diario, mapa y ajustes.

En escritorio se permiten varias columnas cuando reducen navegación. En tablet se usan paneles apilados o con pestañas. En móvil debe existir una tarea principal por vista y navegación inferior para destinos frecuentes.

## 4. Lenguaje y tono

- Idioma inicial de interfaz: español.
- Voz: sobria, clara y evocadora.
- La narración puede ser literaria; los mensajes mecánicos deben ser directos.
- Los errores deben explicar qué ocurrió y qué puede hacer la persona.
- No se presenta una operación como confirmada antes de la respuesta autoritativa.

## 5. Estados obligatorios

Cada flujo asíncrono debe contemplar:

- reposo;
- carga;
- éxito confirmado;
- vacío;
- error recuperable;
- error no recuperable;
- conexión degradada o perdida;
- acción no disponible con motivo visible.

Los estados no dependen solo del color. Los cambios importantes utilizan texto y, cuando proceda, una región `aria-live`.

## 6. Responsive

Matriz mínima:

| Tamaño | Comportamiento |
| --- | --- |
| 390 × 844 | Una columna, bitácora primero, controles de 44 px, sin contenido dependiente de hover |
| 768 × 1024 | Paneles apilados o dos zonas, formularios fluidos |
| 1024 × 768 | Shell compacto; ninguna columna debe forzar desbordamiento |
| 1440 × 900 | Shell multipanel con lectura central prioritaria |

No se admite desbordamiento horizontal del documento.

## 7. Accesibilidad

- Un `h1` por pantalla y jerarquía de encabezados coherente.
- Landmarks y nombres accesibles para navegación, paneles y formularios.
- Operación completa con teclado.
- Foco visible con contraste suficiente.
- Etiquetas persistentes y errores asociados al control correspondiente.
- Targets táctiles de al menos 44 × 44 px cuando corresponda.
- Valores mecánicos expresados como texto, no solo como color o gráfico.
- Movimiento decorativo desactivado con `prefers-reduced-motion`.
- Orden DOM lógico, independiente de la distribución visual.

## 8. Límites mecánicos

- El frontend envía intención o comandos a contratos existentes.
- Solo el servidor determina acciones legales y resultados.
- `COMBAT_CONSEQUENCE.payload.targets[]` es la verdad de consecuencias.
- La narración describe resultados ya confirmados.
- Los componentes React no duplican fórmulas ni reglas de D&D.

## 9. Criterios de aceptación del hito

- El flujo portada → personaje → campaña sigue siendo funcional.
- La bitácora distingue narración, intención y sistema.
- Los contratos de API, SSE y persistencia no cambian.
- Los cuatro tamaños de referencia no presentan desbordamiento horizontal.
- Teclado, foco, estados de carga y errores son verificables.
- El build, TypeScript, tests relevantes y comprobación de canon pasan.
