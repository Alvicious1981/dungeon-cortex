---
name: prisma-migrate
description: Preparar de forma segura una migración Prisma de Dungeon Cortex sin aplicarla a la base de datos real; úsala para diseñar o revisar schema y SQL de migración, regenerar tipos y validar compilación, nunca para ejecutar migrate dev/deploy sobre datos reales.
disable-model-invocation: true
---

# Objetivo

Preparar una migración Prisma compatible con las reglas de `AGENTS.md` sin tocar la base de datos real.

El nombre de esta skill se conserva por compatibilidad histórica. Su comportamiento vigente es **escribir y revisar migraciones, nunca ejecutarlas contra la base real**.

# Procedimiento

1. Lee `AGENTS.md`, `prisma/schema.prisma` y las migraciones relacionadas.
2. Confirma el cambio solicitado, la compatibilidad con datos existentes y el orden de despliegue.
3. Edita `schema.prisma` solo si la tarea lo autoriza.
4. Escribe el SQL de migración siguiendo los patrones vigentes del repositorio.
5. No ejecutes `prisma migrate dev`, `prisma migrate deploy`, seeds ni transformaciones de datos contra la base real.
6. Ejecuta `pnpm prisma generate` cuando proceda; regenera tipos sin aplicar la migración.
7. Ejecuta las validaciones requeridas por `AGENTS.md` para el cambio, usando únicamente scripts existentes.
8. Si se necesita demostrar una migración contra una base, usa únicamente un PostgreSQL desechable y aislado, con autorización expresa cuando `AGENTS.md` la exija.
9. Entrega el orden de despliegue y las comprobaciones posteriores necesarias para el mantenedor.

# Paradas obligatorias

Detente antes de cualquier:
- migración contra la base real;
- operación destructiva o transformación de datos;
- acceso o reproducción de secretos;
- despliegue;
- supuesto sobre el estado real de producción que no esté verificado.

# Entrega

- **CAMBIO DE SCHEMA**
- **MIGRACIÓN PREPARADA**
- **COMPATIBILIDAD DE DATOS**
- **VALIDACIÓN EJECUTADA / NO EJECUTADA**
- **ORDEN DE DESPLIEGUE**
- **RIESGOS**
- **ACCIÓN HUMANA NECESARIA**

Nunca marques como aplicada una migración que no hayas observado aplicada en el entorno autorizado.
