---
name: dc-ai-safety-review
description: Verifica en solo lectura la seguridad narrativa y el canon SRD de prompts, narradores y cambios de la capa de IA de Dungeon Cortex, comprobando que el texto solo describe hechos ya resueltos por el backend; úsala cuando cambien prompts, narración o eventos narrativos, cuando se toque `lib/ai/` en lo relativo a texto, y antes de cerrar una feature narrativa; no la uses para revisar acceso a Prisma o separación general de capas, para implementar correcciones, para migrar deuda histórica de downtime, ni para validar reglas mecánicas completas.
disable-model-invocation: true
---

# Objetivo

Comprobar, sin editar, que la narración y los prompts respetan la frontera del
narrador: describen hechos ya resueltos por el backend y no introducen mecánicas
ni terminología fuera del canon D&D 5e/SRD 2014.

# Entradas

- Archivos, rutas o diff con cambios en prompts, narración o eventos narrativos.

Sin una referencia concreta, no continúes.

# Fuentes y autoridad

- `docs/NARRATIVE_SAFETY.md` — principios de ordenación temporal, alineación con
  los hechos y lista de términos prohibidos.
- `docs/DECISION_5E_SRD_API.md` — canon de reglas y frontera del narrador
  (secciones de autoridad del backend y de la IA).
- El código narrativo afectado y sus pruebas.
- `scripts/check-retro-jargon.ts`, invocado mediante `pnpm check-retro`.

`MASTER_ARCH_GUIDE.md` y `docs/DECISION_5E_SRD_API.md` mantienen la autoridad
cuando cualquier otro material los contradiga.

# Procedimiento

1. Delimita los archivos afectados.
2. Lee las secciones relevantes de `docs/NARRATIVE_SAFETY.md` y
   `docs/DECISION_5E_SRD_API.md`.
3. Revisa el texto de prompts, plantillas y narración frente a los hechos que el
   backend produce.
4. Comprueba:
   - la narración describe hechos ya resueltos;
   - los eventos o resultados del backend preceden al texto;
   - la IA no inventa daño, muerte, condiciones, botín, experiencia ni ningún
     otro resultado mecánico;
   - no se filtran valores que el contrato mantiene ocultos;
   - no aparece terminología retro o AD&D prohibida según
     `docs/NARRATIVE_SAFETY.md`;
   - los prompts mantienen separadas las instrucciones y los datos no fiables
     (entrada del jugador, memoria, contenido recuperado);
   - existen pruebas o evaluaciones proporcionales al cambio.
5. Ejecuta `pnpm check-retro` únicamente cuando el script exista en
   `package.json`, las dependencias ya estén instaladas y la ejecución no
   requiera instalar nada ni ampliar permisos. En cualquier otro caso, declara
   la comprobación como no ejecutada y explica por qué.
6. No corrijas nada en esta ejecución.

## Exclusión de deuda histórica

`docs/NARRATIVE_SAFETY.md` documenta como deuda conocida, fuera de la frontera
narrativa vigente, los módulos de downtime `lib/ai/tools/downtime.ts` y
`lib/rules/downtime.ts`. Si esas rutas aparecen, exclúyelas de los hallazgos
automáticos de terminología.

Esa exclusión evita falsos positivos, pero no convierte esos archivos en modelo
para código nuevo. No propongas migrarlos ni editarlos dentro de esta revisión.

Comprueba la existencia real de esas rutas antes de citarlas: en el momento de
escribir esta skill no estaban presentes en el repositorio y la mención de
`docs/NARRATIVE_SAFETY.md` puede estar desactualizada.

# Paradas obligatorias

Detente e informa cuando:

- no haya archivos ni diff que acoten la revisión;
- se te pida corregir el texto o el código;
- el cambio exija decidir mecánicas nuevas en lugar de narrar hechos existentes;
- `pnpm check-retro` requiera instalar dependencias o permisos adicionales;
- aparezca deuda histórica que exigiría una migración fuera de alcance.

# Entrega

- **RESULTADO** — PASS o HALLAZGOS.
- **ARCHIVOS REVISADOS** — rutas concretas.
- **CHECK-RETRO** — ejecutado con su salida, o no ejecutado con el motivo.
- **HECHOS BACKEND Y NARRACIÓN** — si el texto se ajusta a hechos ya resueltos.
- **TÉRMINOS PROHIBIDOS** — apariciones, con archivo y línea, y exclusiones
  aplicadas.
- **FRONTERA DE CONFIANZA** — separación entre instrucciones y datos no fiables.
- **PRUEBAS FALTANTES** — cobertura narrativa ausente.
- **ACCIÓN ÚNICA** — un solo siguiente paso.

# No utilizar para

- Acceso a Prisma o separación general de capas: usa `dc-rules-integrity`.
- Aplicar correcciones: usa `dc-implement-issue`.
- Revisar una PR completa: usa `dc-review-pr`.
- Migrar o editar los módulos de downtime.
