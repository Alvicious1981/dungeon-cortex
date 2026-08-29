-- Añade las inmunidades a condiciones SRD sobre "Combatant", copiadas del
-- monstruo en la creación del encuentro
-- (docs/superpowers/specs/2026-08-28-damage-modifiers-design.md las dejó
-- explícitamente fuera de alcance; este incremento las recoge).
--
-- ADITIVA. Añade exclusivamente una columna TEXT[] con DEFAULT '{}'.
--
-- El DEFAULT es correcto por la misma razón que en 20260828120000 y por la
-- contraria a 20260814120000: "sin inmunidades" y "array vacío" son la misma
-- afirmación, así que rellenar las filas existentes con '{}' no inventa ningún
-- dato. Un combatiente legacy seguirá recibiendo exactamente las condiciones
-- que recibe hoy. En xpValue no valía, porque allí 0 era un premio legítimo y
-- un DEFAULT habría vuelto indistinguibles las filas heredadas.
--
-- No hay UPDATE ni backfill. Rellenar un combatiente ya persistido exigiría
-- adivinar de qué monstruo salió a partir de su nombre, y esa no es una
-- decisión que le corresponda a una migración de esquema.
--
-- No se añade índice: la columna se lee por fila, nunca como criterio de
-- consulta. SrdMonster sí la indexa porque allí sirve para filtrar.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Igual que 20260814120000 y 20260828120000: un bloque DO es una sola
-- sentencia, así que PostgreSQL lo ejecuta de forma atómica en cualquier
-- invocación —incluido psql en autocommit— y revierte junto con su DDL si algo
-- falla.
DO $add_combatant_condition_immunities$
BEGIN
  -- IF NOT EXISTS protege el escenario en el que la columna ya existiera por
  -- una vía distinta (p.ej. `db push` histórico).
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "conditionImmunities" TEXT[] NOT NULL DEFAULT ''{}''';
END
$add_combatant_condition_immunities$;
