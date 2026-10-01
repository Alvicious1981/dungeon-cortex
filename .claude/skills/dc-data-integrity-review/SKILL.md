---
name: dc-data-integrity-review
description: Revisa en solo lectura cambios de persistencia de Dungeon Cortex para detectar riesgos de transacciones, idempotencia, concurrencia, reintentos, constraints, migraciones y compatibilidad con datos existentes; úsala al tocar Prisma, lib/db o estado persistente; nunca aplica migraciones ni modifica datos.
disable-model-invocation: true
---

# Objetivo

Revisar, sin editar ni ejecutar migraciones, cualquier cambio que pueda afectar a la integridad del estado persistido.

# Entradas

Obligatorio una de estas referencias:
- rutas afectadas;
- rama o rango de commits;
- PR concreta.

Sin un cambio acotado, no audites toda la capa de datos.

# Fuentes y autoridad

1. `AGENTS.md` — reglas operativas y política de migraciones.
2. `MASTER_ARCH_GUIDE.md` — arquitectura y autoridad de persistencia.
3. `docs/DECISION_5E_SRD_API.md` cuando el cambio afecte a reglas/canon.
4. `prisma/schema.prisma`, migraciones y código real afectado.
5. Pruebas relacionadas.

# Comprobaciones

1. **Atomicidad** — las operaciones que deban triunfar o fallar juntas comparten una transacción apropiada.
2. **Idempotencia y reintentos** — repetir una petición equivalente no duplica efectos cuando el contrato exige aplicación única.
3. **Concurrencia** — revisa carreras, actualizaciones perdidas, doble aplicación, lecturas obsoletas y supuestos de orden.
4. **Garantías de esquema** — unique/FK/check/indexes respaldan los invariantes importantes y no dependen solo del llamador.
5. **Migraciones** — compatibilidad hacia delante, datos existentes, locks/backfills, operaciones destructivas y recuperación.
6. **Compatibilidad** — el código nuevo tolera el estado persistido anterior cuando el despliegue lo requiere.
7. **Pruebas** — cobertura proporcional de regresión, duplicados/reintentos, concurrencia y forma de datos.
8. **Evidencia** — distingue siempre observado, inferido y no ejecutado.

# Paradas obligatorias

Devuelve `BLOCKED` cuando:
- se solicite escribir o destruir datos reales;
- haga falta ejecutar una migración no autorizada;
- sea necesario exponer credenciales o secretos;
- no pueda verificarse el estado requerido para una conclusión segura;
- la revisión necesite ampliar el alcance sin evidencia.

# Entrega

DATA INTEGRITY REVIEW

- **ALCANCE**
- **TRANSACCIONES**
- **IDEMPOTENCIA/REINTENTOS**
- **CONCURRENCIA**
- **CONSTRAINTS/ÍNDICES**
- **MIGRACIÓN/COMPATIBILIDAD**
- **PRUEBAS Y EVIDENCIA**
- **HALLAZGOS**
- **COMPROBACIONES NO EJECUTADAS**
- **RIESGO RESIDUAL**
- **VEREDICTO: PASS / PASS WITH NOTES / BLOCKED**

Esta skill nunca ejecuta migraciones, operaciones destructivas, despliegues ni merges.
