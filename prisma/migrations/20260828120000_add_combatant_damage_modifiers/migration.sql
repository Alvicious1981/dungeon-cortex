-- Añade los modificadores de daño SRD sobre "Combatant", copiados del monstruo
-- en la creación del encuentro (docs/superpowers/specs/2026-08-28-damage-modifiers-design.md).
--
-- ADITIVA. Añade exclusivamente tres columnas TEXT[] con DEFAULT '{}'.
--
-- Aquí el DEFAULT sí es correcto, al contrario que en xpValue: "sin
-- modificadores" y "array vacío" son la misma afirmación, así que rellenar las
-- filas existentes con '{}' no inventa ningún dato. Un combatiente legacy
-- seguirá recibiendo exactamente el daño que recibe hoy.
--
-- No hay UPDATE ni backfill. Rellenar un combatiente ya persistido exigiría
-- adivinar de qué monstruo salió a partir de su nombre, y esa no es una
-- decisión que le corresponda a una migración de esquema.
--
-- No se añaden índices: estas columnas se leen por fila, nunca como criterio
-- de consulta. SrdMonster sí las indexa porque allí sirven para filtrar.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Igual que 20260814120000: un bloque DO es una sola sentencia, así que
-- PostgreSQL lo ejecuta de forma atómica en cualquier invocación —incluido
-- psql en autocommit— y revierte junto con su DDL si algo falla.
DO $add_combatant_damage_modifiers$
BEGIN
  -- IF NOT EXISTS protege el escenario en el que las columnas ya existieran
  -- por una vía distinta (p.ej. `db push` histórico).
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "damageImmunities" TEXT[] NOT NULL DEFAULT ''{}''';
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "damageResistances" TEXT[] NOT NULL DEFAULT ''{}''';
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "damageVulnerabilities" TEXT[] NOT NULL DEFAULT ''{}''';
END
$add_combatant_damage_modifiers$;
