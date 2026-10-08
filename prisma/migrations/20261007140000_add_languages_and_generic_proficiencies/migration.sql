-- ============================================================================
-- Migración: 20261007140000_add_languages_and_generic_proficiencies
-- Hito: Canonical Character & Rules Database — Fase 3 (Languages & Proficiencies)
-- ============================================================================
--
-- Añade:
-- 1. "CanonicalProficiency":
--    Catálogo maestro de competencias (armaduras, armas, tiradas de salvación y herramientas).
-- 2. "CharacterLanguage":
--    Idiomas hablados/leídos por el personaje, vinculados a "CanonicalLanguage".
-- 3. "CharacterProficiency":
--    Competencias concretas del personaje, vinculadas a "CanonicalProficiency".
-- 4. RLS deny-by-default activado en todas las tablas nuevas.
--
-- ADITIVA Y SEGURA:
-- No modifica ni elimina ninguna columna ni tabla preexistente.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProficiencyType') THEN
    CREATE TYPE "ProficiencyType" AS ENUM ('ARMOR', 'WEAPON', 'SAVING_THROW', 'TOOL');
  END IF;
END $$;

-- 1. Tabla CanonicalProficiency
CREATE TABLE IF NOT EXISTS "CanonicalProficiency" (
  "rulesetId" TEXT NOT NULL,
  "type" "ProficiencyType" NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "CanonicalProficiency_pkey" PRIMARY KEY ("rulesetId", "type", "code")
);

-- 2. Tabla CharacterLanguage
CREATE TABLE IF NOT EXISTS "CharacterLanguage" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "languageCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterLanguage_pkey" PRIMARY KEY ("id")
);

-- 3. Tabla CharacterProficiency
CREATE TABLE IF NOT EXISTS "CharacterProficiency" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "type" "ProficiencyType" NOT NULL,
  "code" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterProficiency_pkey" PRIMARY KEY ("id")
);

-- 4. Índices y restricciones de unicidad
CREATE INDEX IF NOT EXISTS "CanonicalProficiency_rulesetId_idx" ON "CanonicalProficiency"("rulesetId");
CREATE INDEX IF NOT EXISTS "CanonicalProficiency_rulesetId_type_idx" ON "CanonicalProficiency"("rulesetId", "type");

CREATE UNIQUE INDEX IF NOT EXISTS "CharacterLanguage_characterId_languageCode_key" ON "CharacterLanguage"("characterId", "languageCode");
CREATE INDEX IF NOT EXISTS "CharacterLanguage_characterId_idx" ON "CharacterLanguage"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterLanguage_rulesetId_languageCode_idx" ON "CharacterLanguage"("rulesetId", "languageCode");

CREATE UNIQUE INDEX IF NOT EXISTS "CharacterProficiency_characterId_type_code_key" ON "CharacterProficiency"("characterId", "type", "code");
CREATE INDEX IF NOT EXISTS "CharacterProficiency_characterId_idx" ON "CharacterProficiency"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterProficiency_rulesetId_type_code_idx" ON "CharacterProficiency"("rulesetId", "type", "code");

-- 5. Claves Foráneas con comprobación de existencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalProficiency_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalProficiency"
      ADD CONSTRAINT "CanonicalProficiency_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterLanguage_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterLanguage"
      ADD CONSTRAINT "CharacterLanguage_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterLanguage_rulesetId_languageCode_fkey'
  ) THEN
    ALTER TABLE "CharacterLanguage"
      ADD CONSTRAINT "CharacterLanguage_rulesetId_languageCode_fkey"
      FOREIGN KEY ("rulesetId", "languageCode") REFERENCES "CanonicalLanguage"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterProficiency_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterProficiency"
      ADD CONSTRAINT "CharacterProficiency_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterProficiency_rulesetId_type_code_fkey'
  ) THEN
    ALTER TABLE "CharacterProficiency"
      ADD CONSTRAINT "CharacterProficiency_rulesetId_type_code_fkey"
      FOREIGN KEY ("rulesetId", "type", "code") REFERENCES "CanonicalProficiency"("rulesetId", "type", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. RLS deny-by-default explícito
ALTER TABLE "CanonicalProficiency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CharacterLanguage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CharacterProficiency" ENABLE ROW LEVEL SECURITY;
