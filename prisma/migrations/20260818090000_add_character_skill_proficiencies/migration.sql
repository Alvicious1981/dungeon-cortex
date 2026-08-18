-- Añade "skillProficiencies" sobre "Character": las habilidades SRD en las que
-- el personaje tiene competencia, como array JSON de nombres
-- (p.ej. ["Athletics","Perception"]).
--
-- ADITIVA. Añade exclusivamente la columna nullable "skillProficiencies" JSONB.
--
-- ─── Por qué hacía falta ─────────────────────────────────────────────────────
-- lib/rules/ability-check.ts suma el bono de competencia solo cuando la
-- habilidad usada figura entre las del personaje. Hasta ahora el esquema no
-- guardaba ninguna, así que TODA prueba improvisada se resolvía sin competencia:
-- un guerrero de nivel 3 tiraba Atletismo a +3 en lugar de +5. El cálculo era
-- correcto; le faltaba el dato.
--
-- ─── Deliberadamente NULLABLE y SIN DEFAULT ──────────────────────────────────
-- Misma razón que 20260814120000: un DEFAULT haría que PostgreSQL rellenara con
-- esa constante todas las filas existentes durante el ADD COLUMN, concediendo en
-- silencio competencias que ningún personaje se ganó — y el bono de competencia
-- altera el resultado de cada tirada. NULL = sin competencia, que es la lectura
-- conservadora: nunca infla una tirada.
--
-- Un array vacío y NULL significan ambos "ninguna competencia"; la distinción no
-- es mecánicamente relevante y el código de lectura trata los dos igual.
--
-- No hay UPDATE ni backfill: qué habilidades corresponden a cada personaje ya
-- creado depende de su clase y, cuando exista elección en la creación, de lo que
-- eligiera el jugador. Esa decisión no le corresponde a una migración de esquema.
-- Los personajes existentes seguirán sin competencia hasta que se les asigne por
-- la vía de la aplicación.
--
-- No se añade índice: la columna no se usa como criterio de consulta.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Igual que 20260806090000, 20260807090000 y 20260814120000: un bloque DO es una
-- sola sentencia, así que PostgreSQL lo ejecuta de forma atómica en cualquier
-- invocación —incluido psql en autocommit— y revierte junto con su DDL si algo
-- falla, sin que un COMMIT explícito caiga sobre una transacción ya abortada.
DO $add_character_skill_proficiencies$
BEGIN
  -- IF NOT EXISTS protege el escenario en el que la columna ya existiera por una
  -- vía distinta (p.ej. `db push` histórico), igual que las migraciones de
  -- reconciliación anteriores de este repositorio.
  EXECUTE 'ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "skillProficiencies" JSONB';
END
$add_character_skill_proficiencies$;
