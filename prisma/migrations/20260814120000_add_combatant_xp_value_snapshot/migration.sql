-- Añade el snapshot de XP backend-authorized sobre "Combatant", fijado una vez
-- en la creación del encuentro (docs/DECISION_XP_AWARD_AUTHORITY.md §5-§6).
--
-- ADITIVA. Añade exclusivamente la columna nullable "xpValue" INTEGER.
--
-- Deliberadamente NULLABLE y SIN DEFAULT: un DEFAULT haría que PostgreSQL
-- rellenara con esa constante todas las filas existentes al ejecutar el
-- ADD COLUMN, convirtiendo en silencio cada Combatant legacy en "XP
-- autorizado" en lugar de "no disponible". NULL = unavailable; 0 sigue siendo
-- un premio de XP legítimo (CR 0) y debe seguir siendo distinguible de NULL.
--
-- No hay UPDATE ni backfill: esta migración no decide qué Combatant legacy
-- tuvo qué fuente de XP; esa decisión no le corresponde a una migración de
-- esquema. No se añade índice: xpValue no se usa como criterio de consulta.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que 20260806090000 y 20260807090000: un bloque DO es una sola
-- sentencia, así que PostgreSQL lo ejecuta de forma atómica en cualquier
-- invocación —incluido psql en autocommit— y revierte junto con su DDL si algo
-- falla, sin que un COMMIT explícito caiga sobre una transacción ya abortada.
DO $add_combatant_xp_value_snapshot$
BEGIN
  -- IF NOT EXISTS protege el escenario en el que la columna ya existiera por
  -- una vía distinta (p.ej. `db push` histórico), igual que las migraciones
  -- de reconciliación anteriores de este repositorio.
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "xpValue" INTEGER';
END
$add_combatant_xp_value_snapshot$;
