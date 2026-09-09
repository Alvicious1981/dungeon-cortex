-- Persiste la identidad exacta de cada posición de iniciativa. El total por sí
-- solo no conserva los desempates que rollInitiative ya resolvió (modificador
-- de DEX, tirada natural y, por último, orden estable de entrada).
--
-- ADITIVA. La columna se añade primero como nullable, se completa, y solo
-- entonces pasa a NOT NULL. Las filas legacy ya perdieron los datos de
-- desempate, así que no existe un orden histórico que recuperar: se
-- canonicalizan una sola vez por initiativeTotal DESC, id ASC. El id no cambia
-- la mecánica de encuentros nuevos; solo hace determinista el caso legacy que
-- antes dependía del orden de retorno de PostgreSQL.
--
-- La restricción UNIQUE impide dos identidades para la misma posición dentro
-- de un encuentro. No se añade un índice separado: la restricción crea el
-- índice compuesto que cubre encounterId + initiativeOrder.
--
-- IMPORTANTE: aplicar esta migración antes de desplegar el código que escribe y
-- ordena por initiativeOrder.
DO $add_combatant_initiative_order$
BEGIN
  EXECUTE 'ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "initiativeOrder" INTEGER';

  WITH ranked AS (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "encounterId"
        ORDER BY "initiativeTotal" DESC, "id" ASC
      ) - 1 AS ordinal
    FROM "Combatant"
  )
  UPDATE "Combatant" AS combatant
  SET "initiativeOrder" = ranked.ordinal::INTEGER
  FROM ranked
  WHERE combatant."id" = ranked."id"
    AND combatant."initiativeOrder" IS NULL;

  EXECUTE 'ALTER TABLE "Combatant" ALTER COLUMN "initiativeOrder" SET NOT NULL';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Combatant_encounterId_initiativeOrder_key'
      AND conrelid = '"Combatant"'::regclass
  ) THEN
    ALTER TABLE "Combatant"
      ADD CONSTRAINT "Combatant_encounterId_initiativeOrder_key"
      UNIQUE ("encounterId", "initiativeOrder");
  END IF;
END
$add_combatant_initiative_order$;
