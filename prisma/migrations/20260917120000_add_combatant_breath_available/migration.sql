-- Disponibilidad del ataque de salvación en área del enemigo (el aliento)
-- (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §5, §7).
--
-- ADITIVA. Añade "Combatant"."breathAvailable", NULLABLE y SIN valor por
-- omisión: NULL significa "este monstruo no tiene esa acción". Un valor por
-- omisión inventaría disponibilidad para combatientes que nunca la tuvieron.
--
-- Sin relleno de datos: ningún combatiente existente necesita este campo, y
-- esta migración no decide el estado de ningún encuentro en curso.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. Prisma
-- selecciona todas las columnas escalares; el código nuevo sin este campo
-- rompe toda consulta sobre "Combatant". El código anterior lo ignora.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que las migraciones anteriores: una sola sentencia atómica que
-- revierte con su DDL si algo falla.
DO $add_combatant_breath_available$
BEGIN
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "breathAvailable" BOOLEAN';
END
$add_combatant_breath_available$;
