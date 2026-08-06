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
-- Esta migración es ADITIVA e IDEMPOTENTE. Funciona en los dos escenarios:
--   A) base construida solo con migraciones -> las columnas no existen
--   B) base históricamente pasada por db push -> ya existen, quizá con datos
--
-- No elimina ni recrea nada, no toca IDs, no borra datos, no sobrescribe
-- valores persistidos y no depende de ninguna tabla ajena a "Character".

-- ─── 1. Alta de columnas, deliberadamente NULLABLE y sin DEFAULT ──────────────
-- Añadirlas con DEFAULT haría que PostgreSQL rellenara las filas existentes con
-- una constante (1), que es incorrecta para cualquier personaje por encima del
-- nivel 1. Se añaden vacías para que el backfill del paso 3 decida cada valor.
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "hitDiceTotal" INTEGER;
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "hitDiceRemaining" INTEGER;
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "exhaustionLevel" INTEGER;

-- ─── 2. Aborto explícito ante datos no reconciliables ─────────────────────────
-- Preferimos parar con un mensaje accionable antes que corregir en silencio.
DO $$
DECLARE
  invalid_level     BIGINT;
  invalid_remaining BIGINT;
BEGIN
  -- No se puede derivar el total de dados de golpe sin un nivel válido.
  SELECT count(*) INTO invalid_level
  FROM "Character"
  WHERE "hitDiceTotal" IS NULL
    AND ("level" IS NULL OR "level" < 1);

  IF invalid_level > 0 THEN
    RAISE EXCEPTION
      'No se puede reconciliar Character.hitDiceTotal: % fila(s) tienen "level" nulo o menor que 1. Corrige esas filas y vuelve a aplicar la migración.',
      invalid_level;
  END IF;

  -- Un remanente persistido mayor que el total es un estado inválido que esta
  -- migración no puede arreglar sin sobrescribir datos del usuario.
  SELECT count(*) INTO invalid_remaining
  FROM "Character"
  WHERE "hitDiceRemaining" IS NOT NULL
    AND "hitDiceTotal" IS NOT NULL
    AND "hitDiceRemaining" > "hitDiceTotal";

  IF invalid_remaining > 0 THEN
    RAISE EXCEPTION
      'No se puede reconciliar Character.hitDiceRemaining: % fila(s) almacenan más dados restantes que el total. Esta migración no sobrescribe valores persistidos; corrige esas filas primero.',
      invalid_remaining;
  END IF;
END
$$;

-- ─── 3. Backfill: SOLO valores nulos ─────────────────────────────────────────
-- Por D&D 5e/SRD 2014 el total de dados de golpe es igual al nivel del
-- personaje, tal y como documenta el propio modelo Character. Se deriva del
-- nivel persistido en lugar de asignar un 1 plano.
UPDATE "Character"
SET "hitDiceTotal" = GREATEST("level", 1)
WHERE "hitDiceTotal" IS NULL;

-- El remanente se acota al total para que se cumpla 0 <= remaining <= total.
-- Las filas que ya tenían valor se validaron en el paso 2 y no se tocan.
UPDATE "Character"
SET "hitDiceRemaining" = LEAST(GREATEST("level", 1), "hitDiceTotal")
WHERE "hitDiceRemaining" IS NULL;

UPDATE "Character"
SET "exhaustionLevel" = 0
WHERE "exhaustionLevel" IS NULL;

-- ─── 4. Adoptar el contrato declarado en prisma/schema.prisma ────────────────
-- Defaults primero, NOT NULL después: así una inserción concurrente durante la
-- migración ya recibe un valor y no puede volver a introducir un NULL.
-- Los valores coinciden exactamente con @default(1) / @default(1) / @default(0).
ALTER TABLE "Character" ALTER COLUMN "hitDiceTotal"     SET DEFAULT 1;
ALTER TABLE "Character" ALTER COLUMN "hitDiceRemaining" SET DEFAULT 1;
ALTER TABLE "Character" ALTER COLUMN "exhaustionLevel"  SET DEFAULT 0;

ALTER TABLE "Character" ALTER COLUMN "hitDiceTotal"     SET NOT NULL;
ALTER TABLE "Character" ALTER COLUMN "hitDiceRemaining" SET NOT NULL;
ALTER TABLE "Character" ALTER COLUMN "exhaustionLevel"  SET NOT NULL;

-- No se añade ninguna CHECK constraint: prisma/schema.prisma no declara
-- ninguna, y crear una introduciría nueva deriva en sentido contrario además de
-- una política de juego que no corresponde fijar en SQL.
