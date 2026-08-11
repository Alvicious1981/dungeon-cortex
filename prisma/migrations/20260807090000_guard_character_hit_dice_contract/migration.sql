-- Guarda estructural del contrato de dados de golpe de "Character".
--
-- NO REPARA NADA. No contiene UPDATE, INSERT, DELETE ni DDL de ningún tipo:
-- solo inspecciona y aborta. Esa es su propiedad de seguridad central.
--
-- ─── Por qué guard-only ──────────────────────────────────────────────────────
-- El repositorio no tiene un punto de entrada único para migraciones: no hay
-- script de migración en package.json, el CI no las aplica y la propia
-- documentación indica invocar `prisma migrate dev` directamente. Cualquier
-- diseño que dependa de ejecutar un paso previo puede saltarse, así que la
-- seguridad no puede descansar en el procedimiento del operador.
--
-- Una migración que no escribe es segura por construcción: se aplique por la
-- vía que se aplique, su único efecto posible es pasar o abortar. Nunca puede
-- empeorar el estado de los datos.
--
-- La reparación real vivirá en una herramienta TypeScript que reutilice las
-- reglas de lib/rules/ (autoridad mecánica del backend). Todavía no existe.
--
-- ─── Qué NO comprueba, y por qué ─────────────────────────────────────────────
-- La coherencia xp <-> level queda deliberadamente fuera. Verificarla en SQL
-- exigiría duplicar la tabla de umbrales XP del SRD 5e que vive en
-- lib/rules/progression.ts, creando una segunda autoridad mecánica que puede
-- desincronizarse en silencio. Esta migración no escribe usando "level", así
-- que no necesita demostrar que "level" sea fiable. Esa comprobación pertenece
-- a la herramienta TypeScript, donde getLevelFromXP es invocable directamente.
--
-- ─── Contrato validado ───────────────────────────────────────────────────────
-- Válidos:
--   level = 1  AND hitDiceTotal = 1               (asentado en nivel mínimo)
--   level >= 2 AND hitDiceTotal = level           (asentado)
--   level >= 2 AND hitDiceTotal = level - 1       (level-up pendiente legítimo)
--
-- El estado pendiente solo existe para level >= 2: no hay level-up hacia el
-- nivel 1, y resolveTargetLevel lo rechaza explícitamente (MIN_LEVEL).
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que 20260806090000: un bloque DO es una sola sentencia, así que
-- el RAISE llega intacto tanto bajo la transacción de Prisma como con psql en
-- autocommit, sin que un COMMIT sobre una transacción abortada lo sustituya por
-- un genérico "current transaction is aborted".
DO $guard_character_hit_dice_contract$
DECLARE
  n BIGINT;
BEGIN
  -- ─── 1. Rango de nivel ─────────────────────────────────────────────────────
  -- [1, 20] segun MIN_LEVEL/MAX_LEVEL. Ninguna ruta del backend produce un
  -- valor fuera de rango: getLevelFromXP esta acotado por construccion y la
  -- creacion de personaje fija level = 1. Un valor fuera de rango llego por una
  -- via ajena al backend y no puede repararse sin decidir cual era el nivel real.
  SELECT count(*) INTO n FROM "Character" WHERE "level" < 1 OR "level" > 20;
  IF n > 0 THEN
    RAISE EXCEPTION
      'Contrato de progresion incumplido: % fila(s) de Character tienen "level" fuera del rango [1, 20]. Esta migracion no repara datos; corrige esas filas antes de continuar.',
      n;
  END IF;

  -- ─── 2. Nivel 1: un unico total valido ─────────────────────────────────────
  -- En nivel 1 no existe estado pendiente al que un total distinto de 1 pudiera
  -- corresponder, asi que cualquier otro valor es inequivocamente invalido.
  SELECT count(*) INTO n FROM "Character" WHERE "level" = 1 AND "hitDiceTotal" <> 1;
  IF n > 0 THEN
    RAISE EXCEPTION
      'Contrato de dados de golpe incumplido: % fila(s) de Character de nivel 1 tienen "hitDiceTotal" distinto de 1. En nivel 1 no hay level-up pendiente posible. Esta migracion no repara datos; corrige esas filas antes de continuar.',
      n;
  END IF;

  -- ─── 3. Nivel >= 2: total por encima del nivel ─────────────────────────────
  -- applyLevelUp escribe hitDiceTotal = level exactamente y el descanso nunca
  -- eleva el total, asi que un total mayor que el nivel es inequivocamente
  -- invalido. Se detecta y se aborta; no se acota aqui.
  SELECT count(*) INTO n FROM "Character" WHERE "level" >= 2 AND "hitDiceTotal" > "level";
  IF n > 0 THEN
    RAISE EXCEPTION
      'Contrato de dados de golpe incumplido: % fila(s) de Character tienen "hitDiceTotal" mayor que "level". Ninguna ruta del backend produce ese estado. Esta migracion no repara datos; corrige esas filas antes de continuar.',
      n;
  END IF;

  -- ─── 4. Nivel >= 2: total por debajo del pendiente legitimo ────────────────
  -- AMBIGUO, no simplemente invalido. applyExperienceAward puede subir varios
  -- niveles de una sola concesion de XP sin tocar hitDiceTotal, asi que
  -- level=5/total=1 es alcanzable de forma legitima y resulta indistinguible de
  -- una corrupcion historica. Reparar a "level" concederia dados de golpe sin la
  -- tirada de PV correspondiente: seria inventar mecanica. Se aborta para
  -- revision humana.
  SELECT count(*) INTO n FROM "Character" WHERE "level" >= 2 AND "hitDiceTotal" < "level" - 1;
  IF n > 0 THEN
    RAISE EXCEPTION
      'Estado de dados de golpe ambiguo: % fila(s) de Character tienen "hitDiceTotal" por debajo de "level" - 1. No se puede distinguir una progresion multinivel pendiente de una corrupcion, asi que no se repara automaticamente. Revisa esas filas antes de continuar.',
      n;
  END IF;

  -- ─── 5. Remanente fuera de rango ───────────────────────────────────────────
  -- Contrato declarado en prisma/schema.prisma: 0 <= remaining <= total.
  SELECT count(*) INTO n FROM "Character" WHERE "hitDiceRemaining" < 0;
  IF n > 0 THEN
    RAISE EXCEPTION
      'Contrato de dados de golpe incumplido: % fila(s) de Character tienen "hitDiceRemaining" negativo. Esta migracion no repara datos; corrige esas filas antes de continuar.',
      n;
  END IF;

  SELECT count(*) INTO n FROM "Character" WHERE "hitDiceRemaining" > "hitDiceTotal";
  IF n > 0 THEN
    RAISE EXCEPTION
      'Contrato de dados de golpe incumplido: % fila(s) de Character almacenan mas dados restantes que el total. Esta migracion no repara datos; corrige esas filas antes de continuar.',
      n;
  END IF;
END
$guard_character_hit_dice_contract$;
