-- ============================================================================
-- Migración: 20261007160000_add_species_traits_and_origins
-- Hito: Canonical Character & Rules Database — Fase 5 (Species/Races, Traits & Origins)
-- ============================================================================
--
-- Añade:
-- 1. "CanonicalRace":
--    Catálogo maestro de razas/especies (9 razas oficiales del SRD 5.1 con speed y size).
-- 2. "CanonicalTrait":
--    Catálogo maestro de rasgos raciales y de linaje del SRD.
-- 3. "CanonicalRaceTrait":
--    Tabla relacional que asocia cada raza con los rasgos que otorga el ruleset.
-- 4. "CanonicalBackground":
--    Catálogo maestro de trasfondos (Acolyte, etc.) del SRD.
-- 5. "CharacterOrigin":
--    Identidad biológica y social normalizada del personaje vinculada 1:1 con Character.
-- 6. RLS deny-by-default activado explícitamente en todas las tablas nuevas.
--
-- ADITIVA Y SEGURA:
-- No modifica ni elimina ninguna columna ni tabla preexistente.
-- ============================================================================

-- 1. Tabla CanonicalRace
CREATE TABLE IF NOT EXISTS "CanonicalRace" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "speed" INTEGER NOT NULL DEFAULT 30,
  "size" TEXT NOT NULL DEFAULT 'Medium',
  "description" TEXT,
  CONSTRAINT "CanonicalRace_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 2. Tabla CanonicalTrait
CREATE TABLE IF NOT EXISTS "CanonicalTrait" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "CanonicalTrait_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 3. Tabla CanonicalRaceTrait
CREATE TABLE IF NOT EXISTS "CanonicalRaceTrait" (
  "rulesetId" TEXT NOT NULL,
  "raceCode" TEXT NOT NULL,
  "traitCode" TEXT NOT NULL,
  CONSTRAINT "CanonicalRaceTrait_pkey" PRIMARY KEY ("rulesetId", "raceCode", "traitCode")
);

-- 4. Tabla CanonicalBackground
CREATE TABLE IF NOT EXISTS "CanonicalBackground" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "featureName" TEXT,
  CONSTRAINT "CanonicalBackground_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 5. Tabla CharacterOrigin
CREATE TABLE IF NOT EXISTS "CharacterOrigin" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "raceCode" TEXT NOT NULL,
  "backgroundCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterOrigin_pkey" PRIMARY KEY ("id")
);

-- 6. Índices y restricciones de unicidad
CREATE INDEX IF NOT EXISTS "CanonicalRace_rulesetId_idx" ON "CanonicalRace"("rulesetId");

CREATE INDEX IF NOT EXISTS "CanonicalTrait_rulesetId_idx" ON "CanonicalTrait"("rulesetId");

CREATE INDEX IF NOT EXISTS "CanonicalRaceTrait_rulesetId_raceCode_idx" ON "CanonicalRaceTrait"("rulesetId", "raceCode");
CREATE INDEX IF NOT EXISTS "CanonicalRaceTrait_rulesetId_traitCode_idx" ON "CanonicalRaceTrait"("rulesetId", "traitCode");

CREATE INDEX IF NOT EXISTS "CanonicalBackground_rulesetId_idx" ON "CanonicalBackground"("rulesetId");

CREATE UNIQUE INDEX IF NOT EXISTS "CharacterOrigin_characterId_key" ON "CharacterOrigin"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterOrigin_characterId_idx" ON "CharacterOrigin"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterOrigin_rulesetId_raceCode_idx" ON "CharacterOrigin"("rulesetId", "raceCode");
CREATE INDEX IF NOT EXISTS "CharacterOrigin_rulesetId_backgroundCode_idx" ON "CharacterOrigin"("rulesetId", "backgroundCode");

-- 7. Claves Foráneas con comprobación de existencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalRace_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalRace"
      ADD CONSTRAINT "CanonicalRace_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalTrait_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalTrait"
      ADD CONSTRAINT "CanonicalTrait_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalRaceTrait_rulesetId_raceCode_fkey'
  ) THEN
    ALTER TABLE "CanonicalRaceTrait"
      ADD CONSTRAINT "CanonicalRaceTrait_rulesetId_raceCode_fkey"
      FOREIGN KEY ("rulesetId", "raceCode") REFERENCES "CanonicalRace"("rulesetId", "code")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalRaceTrait_rulesetId_traitCode_fkey'
  ) THEN
    ALTER TABLE "CanonicalRaceTrait"
      ADD CONSTRAINT "CanonicalRaceTrait_rulesetId_traitCode_fkey"
      FOREIGN KEY ("rulesetId", "traitCode") REFERENCES "CanonicalTrait"("rulesetId", "code")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalBackground_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalBackground"
      ADD CONSTRAINT "CanonicalBackground_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterOrigin_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterOrigin"
      ADD CONSTRAINT "CharacterOrigin_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterOrigin_rulesetId_raceCode_fkey'
  ) THEN
    ALTER TABLE "CharacterOrigin"
      ADD CONSTRAINT "CharacterOrigin_rulesetId_raceCode_fkey"
      FOREIGN KEY ("rulesetId", "raceCode") REFERENCES "CanonicalRace"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterOrigin_rulesetId_backgroundCode_fkey'
  ) THEN
    ALTER TABLE "CharacterOrigin"
      ADD CONSTRAINT "CharacterOrigin_rulesetId_backgroundCode_fkey"
      FOREIGN KEY ("rulesetId", "backgroundCode") REFERENCES "CanonicalBackground"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 8. RLS deny-by-default explícito
ALTER TABLE "CanonicalRace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalTrait" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalRaceTrait" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalBackground" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CharacterOrigin" ENABLE ROW LEVEL SECURITY;
