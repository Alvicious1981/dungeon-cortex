-- Estado de las tiradas de muerte y de la muerte permanente
-- (docs/superpowers/specs/2026-09-15-death-saves-design.md §4, §8, §9).
--
-- ADITIVA. Añade "Combatant"."stableWakeRound" y "Character"."diedAt",
-- ambas NULLABLE y SIN valor por omisión: NULL significa "no estable" y "vivo".
-- Un valor por omisión inventaría un estado.
--
-- Añade tres CHECK como segunda defensa junto a DEATH_SAVE_INVARIANT: ningún
-- escritor futuro puede guardar un contador imposible. Las columnas de
-- contadores nunca tuvieron escritor, así que toda fila vale 0; aun así se
-- cuentan antes las filas fuera de rango y se aborta con un mensaje claro.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. Prisma selecciona
-- todas las columnas escalares; el código nuevo sin estas columnas rompe toda
-- consulta sobre "Combatant" y "Character". El código anterior las ignora.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que 20260814120000: una sola sentencia atómica que revierte con su
-- DDL si algo falla.
DO $add_death_save_state$
DECLARE
  out_of_range integer;
BEGIN
  SELECT count(*) INTO out_of_range
  FROM "Combatant"
  WHERE "deathSaveSuccesses" NOT BETWEEN 0 AND 3
     OR "deathSaveFailures" NOT BETWEEN 0 AND 3;
  IF out_of_range > 0 THEN
    RAISE EXCEPTION 'add_death_save_state: % Combatant rows hold death-save counters outside 0..3', out_of_range;
  END IF;

  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "stableWakeRound" INTEGER';
  EXECUTE 'ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "diedAt" TIMESTAMP(3)';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Combatant_deathSaveSuccesses_range') THEN
    EXECUTE 'ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_deathSaveSuccesses_range" CHECK ("deathSaveSuccesses" BETWEEN 0 AND 3)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Combatant_deathSaveFailures_range') THEN
    EXECUTE 'ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_deathSaveFailures_range" CHECK ("deathSaveFailures" BETWEEN 0 AND 3)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Combatant_stableWakeRound_min') THEN
    EXECUTE 'ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_stableWakeRound_min" CHECK ("stableWakeRound" IS NULL OR "stableWakeRound" >= 1)';
  END IF;
END
$add_death_save_state$;
