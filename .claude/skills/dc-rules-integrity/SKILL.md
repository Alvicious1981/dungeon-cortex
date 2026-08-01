---
name: dc-rules-integrity
description: Verifica en solo lectura la separación arquitectónica "Code is Law" (IA narra, reglas resuelven, base de datos guarda) sobre las rutas o el diff indicados; úsala al tocar `lib/ai/`, `app/api/` o `lib/rules/`, al introducir rutas, servicios o herramientas nuevas, y antes de cerrar cambios que puedan mezclar reglas, persistencia y narración; no la uses para revisar terminología narrativa, para implementar correcciones, ni para auditar todo el repositorio sin rutas o cambio concreto.
disable-model-invocation: true
---

# Objetivo

Comprobar, sin editar, que un cambio respeta la separación de capas del
proyecto: la IA narra, `lib/rules/` resuelve mecánicas y `lib/db/` junto con
Prisma poseen el estado.

# Entradas

Obligatorio una de estas dos:

- lista de rutas afectadas, o
- referencia del cambio (rama, rango de commits o PR) del que obtener el diff.

Sin rutas ni diff, no continúes.

# Fuentes y autoridad

Autoridad:

- `MASTER_ARCH_GUIDE.md`, secciones de ley del sistema y autoridad de
  resolución.
- `docs/DECISION_5E_SRD_API.md`, secciones de autoridad del backend y frontera
  del narrador.
- `AGENTS.md` para reglas operativas.

Referencias procedimentales que debes consultar y aplicar de forma acotada, sin
copiar su contenido aquí:

- `.claude/skills/rules-audit/SKILL.md` — búsquedas concretas ya definidas.
- `.claude/agents/rules-integrity-reviewer.md` — tabla de capas y proceso de
  revisión.
- `.codex/agents/rules-integrity-reviewer.toml` — espejo para Codex, útil solo
  para comparar.

Esas referencias no son autoridad arquitectónica: describen cómo revisar, no qué
es correcto.

# Procedimiento

1. Confirma las rutas afectadas o extrae el diff del cambio.
2. Lee las secciones relevantes de `MASTER_ARCH_GUIDE.md` y
   `docs/DECISION_5E_SRD_API.md`.
3. Consulta la skill y el agente ya existentes y reutiliza sus búsquedas en
   lugar de inventar otras nuevas.
4. Ejecuta búsquedas de solo lectura limitadas a las rutas afectadas.
5. Cita archivo y línea de cada violación.
6. No corrijas nada durante esta ejecución.

Comprobaciones mínimas:

- la capa de IA no decide tiradas ni resultados mecánicos;
- la narración no muta puntos de golpe, inventario, progresión ni estado;
- `lib/rules/` no accede directamente a Prisma cuando la arquitectura lo
  prohíbe;
- las mutaciones ocurren en los servicios autorizados;
- el flujo respeta el orden intención → validación → mutación → narración;
- la narración se apoya en hechos ya resueltos por el backend;
- no aparecen escrituras ni dependencias hacia capas inesperadas;
- las pruebas cubren los límites afectados.

# Paradas obligatorias

Detente e informa cuando:

- no haya rutas ni diff que acoten la revisión;
- se te pida corregir el código en esta misma ejecución;
- la arquitectura vigente no cubra el caso y haga falta una decisión del
  propietario;
- el cambio introduzca una capa, servicio o dependencia nueva no prevista.

# Entrega

Si no hay violaciones:

- **PASS**, con la lista de archivos y rutas revisadas.

Si hay violaciones, una entrada por violación con:

- archivo y línea;
- invariante roto;
- capa correcta;
- riesgo;
- corrección sugerida;
- prueba que falta.

# No utilizar para

- Revisar terminología narrativa o canon SRD del texto: usa
  `dc-ai-safety-review`.
- Aplicar las correcciones: usa `dc-implement-issue`.
- Auditoría general del repositorio: usa `dc-read-only-audit`.
