-- Origen y fin de los estados que imponen los conjuros
-- (docs/DECISION_SPELL_CONDITIONS.md).
--
-- ADITIVA. Añade "Combatant"."spellConditions" JSONB NOT NULL DEFAULT '[]'.
-- Cada elemento dice qué conjuro puso un estado de "conditions", quién lo
-- lanzó y cuándo termina (lib/rules/spell-conditions.ts).
--
-- El valor por omisión NO es una afirmación inventada: una lista vacía y
-- "ningún conjuro ha puesto un estado sobre este combatiente" son el mismo
-- hecho, igual que '{}' en las columnas de modificadores de daño. Hasta esta
-- versión ningún conjuro aplicaba estados, así que toda fila existente está,
-- de verdad, en ese caso.
--
-- Sin relleno de datos: no hay nada que rellenar.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. Prisma
-- selecciona todas las columnas escalares; el código nuevo sin esta columna
-- rompe toda consulta sobre "Combatant". El código anterior la ignora.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que las migraciones anteriores: una sola sentencia atómica que
-- revierte con su DDL si algo falla.
DO $add_combatant_spell_conditions$
BEGIN
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "spellConditions" JSONB NOT NULL DEFAULT ''[]''';
END
$add_combatant_spell_conditions$;
