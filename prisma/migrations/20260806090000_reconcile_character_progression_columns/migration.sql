-- Reconcilia las columnas de progresión de "Character" que entraron en
-- prisma/schema.prisma sin migración asociada:
--
--   310c14c (2026-04-14) "feat(progression): implement hybrid XP engine…"
--       -> hitDiceTotal, hitDiceRemaining
--   7dd2733 (2026-04-15) "feat(exploration): finalize Milestone O…"
--       -> exhaustionLevel
--
-- Ambos commits aplicaron el cambio con `db push` y nunca lo reconciliaron, así
-- que una base construida solo con migraciones carece de las tres columnas y
-- Prisma Client falla con P2022 al crear un Character.
--
-- ADITIVA e IDEMPOTENTE. Funciona en los dos escenarios:
--   A) base construida solo con migraciones -> las columnas no existen
--   B) base históricamente pasada por db push -> ya existen, quizá con datos
--
-- No elimina ni recrea nada, no toca IDs, no borra datos, no sobrescribe
-- valores persistidos y no depende de ninguna tabla ajena a "Character".
--
-- ─── Por qué TODO va dentro de un único bloque DO ────────────────────────────
-- Atomicidad. `prisma migrate deploy` envuelve el fichero en su propia
-- transacción, pero aplicarlo a mano con `psql` no: en esa vía, un aborto de
-- validación dejaba las tres columnas ya creadas y la base a medias.
--
-- Un bloque DO es UNA sola sentencia, así que PostgreSQL lo ejecuta de forma
-- atómica en cualquier invocación —psql en autocommit incluido— y su DDL
-- revierte con el resto. Se prefiere a un BEGIN/COMMIT explícito porque, al
-- anidarse dentro de la transacción de Prisma, el COMMIT final caía sobre una
-- transacción ya abortada y sustituía el mensaje de RAISE por un genérico
-- "current transaction is aborted", dejando al operador sin nada accionable.
-- Con el bloque DO, el mensaje llega intacto por las dos vías.
DO $reconcile_character_progression$
DECLARE
  offending TEXT;
  n         BIGINT;
BEGIN
  -- ─── 0. Guarda de tipos, ANTES de tocar nada ───────────────────────────────
  -- Si alguna columna ya existe con un tipo distinto de INTEGER se aborta. No se
  -- intenta ninguna conversión implícita: cambiar el tipo de una columna con
  -- datos no es una decisión que corresponda a una migración de reconciliación.
  SELECT string_agg(column_name || ' (' || data_type || ')', ', ' ORDER BY column_name)
    INTO offending
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'Character'
    AND column_name IN ('hitDiceTotal', 'hitDiceRemaining', 'exhaustionLevel')
    AND data_type <> 'integer';

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'No se puede reconciliar la progresión de Character: % ya existe(n) con un tipo distinto de INTEGER. Esta migración no convierte tipos; ajusta la columna manualmente y vuelve a aplicarla.',
      offending;
  END IF;

  -- ─── 1. Alta de columnas, deliberadamente NULLABLE y sin DEFAULT ───────────
  -- Añadirlas con DEFAULT haría que PostgreSQL rellenara las filas existentes
  -- con una constante (1), incorrecta para cualquier personaje por encima del
  -- nivel 1. Se añaden vacías para que el backfill del paso 3 decida cada valor.
  EXECUTE 'ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "hitDiceTotal" INTEGER';
  EXECUTE 'ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "hitDiceRemaining" INTEGER';
  EXECUTE 'ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "exhaustionLevel" INTEGER';

  -- ─── 2. Precondición del backfill: nivel utilizable ────────────────────────
  SELECT count(*) INTO n
  FROM "Character"
  WHERE "hitDiceTotal" IS NULL
    AND ("level" IS NULL OR "level" < 1);

  IF n > 0 THEN
    RAISE EXCEPTION
      'No se puede reconciliar Character.hitDiceTotal: % fila(s) tienen "level" nulo o menor que 1. Corrige esas filas y vuelve a aplicar la migración.',
      n;
  END IF;

  -- ─── 3. Backfill: SOLO valores nulos ───────────────────────────────────────
  -- Por D&D 5e/SRD 2014 el total de dados de golpe es igual al nivel del
  -- personaje, tal y como documenta el propio modelo Character. Se deriva del
  -- nivel persistido en lugar de asignar un 1 plano.
  UPDATE "Character"
  SET "hitDiceTotal" = GREATEST("level", 1)
  WHERE "hitDiceTotal" IS NULL;

  -- El remanente se acota al total para que se cumpla 0 <= remaining <= total.
  -- Las filas que ya tenían valor no se tocan: se validan en el paso 4.
  UPDATE "Character"
  SET "hitDiceRemaining" = LEAST(GREATEST("level", 1), "hitDiceTotal")
  WHERE "hitDiceRemaining" IS NULL;

  UPDATE "Character"
  SET "exhaustionLevel" = 0
  WHERE "exhaustionLevel" IS NULL;

  -- ─── 4. Validación FINAL de invariantes ────────────────────────────────────
  -- Después del backfill y antes de fijar NOT NULL, porque hasta aquí no se
  -- conoce el estado definitivo de cada fila. Es lo que atrapa el caso cruzado
  -- en el que "hitDiceTotal" era NULL y "hitDiceRemaining" ya guardaba un valor
  -- mayor que el total recién derivado: comprobarlo solo antes del backfill
  -- dejaba pasar esa combinación.
  SELECT count(*) INTO n FROM "Character"
  WHERE "hitDiceTotal" IS NULL OR "hitDiceTotal" < 1;
  IF n > 0 THEN
    RAISE EXCEPTION
      'No se puede reconciliar Character.hitDiceTotal: % fila(s) quedarían con un total nulo o menor que 1, que el servicio de progresión rechaza. Corrige esas filas y vuelve a aplicar la migración.',
      n;
  END IF;

  SELECT count(*) INTO n FROM "Character"
  WHERE "hitDiceRemaining" IS NULL OR "hitDiceRemaining" < 0;
  IF n > 0 THEN
    RAISE EXCEPTION
      'No se puede reconciliar Character.hitDiceRemaining: % fila(s) quedarían con un remanente nulo o negativo. El contrato exige 0 <= remaining <= total; corrige esas filas primero.',
      n;
  END IF;

  SELECT count(*) INTO n FROM "Character"
  WHERE "hitDiceRemaining" > "hitDiceTotal";
  IF n > 0 THEN
    RAISE EXCEPTION
      'No se puede reconciliar Character.hitDiceRemaining: % fila(s) almacenan más dados restantes que el total. Esta migración no sobrescribe valores persistidos; corrige esas filas primero.',
      n;
  END IF;

  SELECT count(*) INTO n FROM "Character" WHERE "exhaustionLevel" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'No se puede reconciliar Character.exhaustionLevel: % fila(s) siguen a NULL tras el backfill. Revisa el estado de esas filas y vuelve a aplicar la migración.',
      n;
  END IF;

  -- ─── 5. Adoptar el contrato declarado en prisma/schema.prisma ──────────────
  -- Defaults primero, NOT NULL después: así una inserción concurrente durante la
  -- migración ya recibe un valor y no puede volver a introducir un NULL.
  -- Los valores coinciden exactamente con @default(1) / @default(1) / @default(0).
  EXECUTE 'ALTER TABLE "Character" ALTER COLUMN "hitDiceTotal" SET DEFAULT 1';
  EXECUTE 'ALTER TABLE "Character" ALTER COLUMN "hitDiceRemaining" SET DEFAULT 1';
  EXECUTE 'ALTER TABLE "Character" ALTER COLUMN "exhaustionLevel" SET DEFAULT 0';

  EXECUTE 'ALTER TABLE "Character" ALTER COLUMN "hitDiceTotal" SET NOT NULL';
  EXECUTE 'ALTER TABLE "Character" ALTER COLUMN "hitDiceRemaining" SET NOT NULL';
  EXECUTE 'ALTER TABLE "Character" ALTER COLUMN "exhaustionLevel" SET NOT NULL';

  -- No se añade ninguna CHECK constraint: prisma/schema.prisma no declara
  -- ninguna, y crear una introduciría nueva deriva en sentido contrario además
  -- de una política de juego que no corresponde fijar en SQL. Las invariantes se
  -- protegen con el backfill y con los abortos del paso 4.
END
$reconcile_character_progression$;
