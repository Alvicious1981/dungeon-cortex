-- Añade el perfil de ataque del enemigo sobre "Combatant", fijado una vez en la
-- creación del encuentro (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §4, §7).
--
-- ADITIVA. Añade exclusivamente la columna nullable "attackProfile" JSONB.
--
-- Deliberadamente NULLABLE y SIN DEFAULT: NULL es un hecho con significado —
-- "sin ataque reconocido" o "fila anterior a esta columna"— y en ambos casos el
-- turno del enemigo se salta (falla cerrado). Un DEFAULT rellenaría las filas
-- existentes con un perfil inventado.
--
-- Sin UPDATE ni backfill: esta migración no decide qué enemigos legacy atacan.
-- Sin índice: la columna no es criterio de consulta.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. En cuanto el esquema
-- tiene el campo, el finalizador de turnos lo selecciona en cada acción de
-- combate; desplegar antes de migrar detiene el combate, no lo degrada.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que 20260814120000: un bloque DO es una sola sentencia, atómica en
-- cualquier invocación, y revierte con su DDL si algo falla.
DO $add_combatant_attack_profile$
BEGIN
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "attackProfile" JSONB';
END
$add_combatant_attack_profile$;
