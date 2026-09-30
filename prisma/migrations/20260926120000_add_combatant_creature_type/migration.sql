-- Tipo de criatura del SRD en "Combatant" (docs/DECISION_SPELL_CONDITIONS.md,
-- fase 2): "Inmovilizar persona" solo puede elegir un humanoide, e
-- "Inmovilizar monstruo" no afecta a muertos vivientes.
--
-- ADITIVA. Añade "Combatant"."creatureType" TEXT, NULLABLE y SIN valor por
-- omisión: NULL significa "tipo desconocido". Un valor por omisión (p.ej.
-- 'humanoid') inventaría un tipo para cada combatiente existente, y un conjuro
-- que exige un humanoide lo aceptaría sin fundamento. Los conjuros que nombran
-- sus objetivos rechazan un tipo desconocido.
--
-- Sin relleno de datos: los combatientes existentes pertenecen a encuentros ya
-- creados; el tipo se fija al crear el siguiente encuentro.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. Prisma selecciona
-- todas las columnas escalares y lib/memory/context.ts la selecciona en cada
-- acción de campaña; el código nuevo sin esta columna rompe el juego. El
-- código anterior la ignora.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que las migraciones anteriores: una sola sentencia atómica que
-- revierte con su DDL si algo falla.
DO $add_combatant_creature_type$
BEGIN
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "creatureType" TEXT';
END
$add_combatant_creature_type$;
