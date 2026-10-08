-- ============================================================================
-- Migración: 20261007170000_add_features_feats_and_choices
-- Hito: Canonical Character & Rules Database — Fase 6 (Features, Feats & Choices)
-- ============================================================================
--
-- Añade:
-- 1. "FeatureType" enum:
--    Categorías oficiales de rasgos ('CLASS', 'SUBCLASS', 'FEAT', 'RACIAL').
-- 2. "CanonicalFeature":
--    Catálogo maestro de rasgos y capacidades mecánicas por clase y nivel.
-- 3. "CanonicalFeat":
--    Catálogo maestro de dotes canónicas del SRD 5.1 con prerrequisitos.
-- 4. "CharacterFeature":
--    Rasgos poseídos por el personaje con trazabilidad de procedencia ("source").
-- 5. "CharacterFeat":
--    Dotes seleccionadas por el personaje.
-- 6. RLS deny-by-default activado explícitamente en todas las tablas nuevas.
--
-- ADITIVA Y SEGURA:
-- No modifica ni elimina ninguna columna ni tabla preexistente.
-- ============================================================================

-- 1. Enum FeatureType
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeatureType') THEN
    CREATE TYPE "FeatureType" AS ENUM ('CLASS', 'SUBCLASS', 'FEAT', 'RACIAL');
  END IF;
END $$;

-- 2. Tabla CanonicalFeature
CREATE TABLE IF NOT EXISTS "CanonicalFeature" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "classCode" TEXT,
  "subclassCode" TEXT,
  "requiredLevel" INTEGER NOT NULL DEFAULT 1,
  "featureType" "FeatureType" NOT NULL DEFAULT 'CLASS',
  CONSTRAINT "CanonicalFeature_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 3. Tabla CanonicalFeat
CREATE TABLE IF NOT EXISTS "CanonicalFeat" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "prerequisite" TEXT,
  CONSTRAINT "CanonicalFeat_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 4. Tabla CharacterFeature
CREATE TABLE IF NOT EXISTS "CharacterFeature" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "featureCode" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterFeature_pkey" PRIMARY KEY ("id")
);

-- 5. Tabla CharacterFeat
CREATE TABLE IF NOT EXISTS "CharacterFeat" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "featCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterFeat_pkey" PRIMARY KEY ("id")
);

-- 6. Índices y restricciones de unicidad
CREATE INDEX IF NOT EXISTS "CanonicalFeature_rulesetId_idx" ON "CanonicalFeature"("rulesetId");
CREATE INDEX IF NOT EXISTS "CanonicalFeature_rulesetId_classCode_requiredLevel_idx" ON "CanonicalFeature"("rulesetId", "classCode", "requiredLevel");

CREATE INDEX IF NOT EXISTS "CanonicalFeat_rulesetId_idx" ON "CanonicalFeat"("rulesetId");

CREATE UNIQUE INDEX IF NOT EXISTS "CharacterFeature_characterId_featureCode_key" ON "CharacterFeature"("characterId", "featureCode");
CREATE INDEX IF NOT EXISTS "CharacterFeature_characterId_idx" ON "CharacterFeature"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterFeature_rulesetId_featureCode_idx" ON "CharacterFeature"("rulesetId", "featureCode");

CREATE UNIQUE INDEX IF NOT EXISTS "CharacterFeat_characterId_featCode_key" ON "CharacterFeat"("characterId", "featCode");
CREATE INDEX IF NOT EXISTS "CharacterFeat_characterId_idx" ON "CharacterFeat"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterFeat_rulesetId_featCode_idx" ON "CharacterFeat"("rulesetId", "featCode");

-- 7. Claves Foráneas con comprobación de existencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalFeature_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalFeature"
      ADD CONSTRAINT "CanonicalFeature_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalFeature_rulesetId_classCode_fkey'
  ) THEN
    ALTER TABLE "CanonicalFeature"
      ADD CONSTRAINT "CanonicalFeature_rulesetId_classCode_fkey"
      FOREIGN KEY ("rulesetId", "classCode") REFERENCES "CanonicalClass"("rulesetId", "code")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalFeature_rulesetId_classCode_subclassCode_fkey'
  ) THEN
    ALTER TABLE "CanonicalFeature"
      ADD CONSTRAINT "CanonicalFeature_rulesetId_classCode_subclassCode_fkey"
      FOREIGN KEY ("rulesetId", "classCode", "subclassCode") REFERENCES "CanonicalSubclass"("rulesetId", "classCode", "code")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalFeat_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalFeat"
      ADD CONSTRAINT "CanonicalFeat_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterFeature_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterFeature"
      ADD CONSTRAINT "CharacterFeature_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterFeature_rulesetId_featureCode_fkey'
  ) THEN
    ALTER TABLE "CharacterFeature"
      ADD CONSTRAINT "CharacterFeature_rulesetId_featureCode_fkey"
      FOREIGN KEY ("rulesetId", "featureCode") REFERENCES "CanonicalFeature"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterFeat_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterFeat"
      ADD CONSTRAINT "CharacterFeat_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterFeat_rulesetId_featCode_fkey'
  ) THEN
    ALTER TABLE "CharacterFeat"
      ADD CONSTRAINT "CharacterFeat_rulesetId_featCode_fkey"
      FOREIGN KEY ("rulesetId", "featCode") REFERENCES "CanonicalFeat"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 8. RLS deny-by-default explícito
ALTER TABLE "CanonicalFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalFeat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CharacterFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CharacterFeat" ENABLE ROW LEVEL SECURITY;
