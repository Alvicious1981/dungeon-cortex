-- ============================================================================
-- Migración: 20261007150000_add_canonical_classes_and_subclasses
-- Hito: Canonical Character & Rules Database — Fase 4 (Classes, Subclasses & Progression)
-- ============================================================================
--
-- Añade:
-- 1. "CanonicalClass":
--    Catálogo maestro de clases (12 clases del SRD 5.1 con dado de golpe, atributos y nivel de subclase).
-- 2. "CanonicalSubclass":
--    Catálogo maestro de subclases (12 subclases canónicas del SRD 5.1).
-- 3. "CharacterClassLevel":
--    Progreso del personaje por clase (nivel, subclase elegida, rol primario).
-- 4. RLS deny-by-default activado en todas las tablas nuevas.
--
-- ADITIVA Y SEGURA:
-- No modifica ni elimina ninguna columna ni tabla preexistente.
-- ============================================================================

-- 1. Tabla CanonicalClass
CREATE TABLE IF NOT EXISTS "CanonicalClass" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "hitDie" INTEGER NOT NULL,
  "primaryAbility" TEXT NOT NULL,
  "spellcastingAbility" TEXT,
  "subclassLevel" INTEGER NOT NULL DEFAULT 3,
  CONSTRAINT "CanonicalClass_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 2. Tabla CanonicalSubclass
CREATE TABLE IF NOT EXISTS "CanonicalSubclass" (
  "rulesetId" TEXT NOT NULL,
  "classCode" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "CanonicalSubclass_pkey" PRIMARY KEY ("rulesetId", "classCode", "code")
);

-- 3. Tabla CharacterClassLevel
CREATE TABLE IF NOT EXISTS "CharacterClassLevel" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "classCode" TEXT NOT NULL,
  "subclassCode" TEXT,
  "level" INTEGER NOT NULL DEFAULT 1,
  "isPrimary" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterClassLevel_pkey" PRIMARY KEY ("id")
);

-- 4. Índices y restricciones de unicidad
CREATE INDEX IF NOT EXISTS "CanonicalClass_rulesetId_idx" ON "CanonicalClass"("rulesetId");

CREATE INDEX IF NOT EXISTS "CanonicalSubclass_rulesetId_classCode_idx" ON "CanonicalSubclass"("rulesetId", "classCode");

CREATE UNIQUE INDEX IF NOT EXISTS "CharacterClassLevel_characterId_classCode_key" ON "CharacterClassLevel"("characterId", "classCode");
CREATE INDEX IF NOT EXISTS "CharacterClassLevel_characterId_idx" ON "CharacterClassLevel"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterClassLevel_rulesetId_classCode_idx" ON "CharacterClassLevel"("rulesetId", "classCode");
CREATE INDEX IF NOT EXISTS "CharacterClassLevel_rulesetId_classCode_subclassCode_idx" ON "CharacterClassLevel"("rulesetId", "classCode", "subclassCode");

-- 5. Claves Foráneas con comprobación de existencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalClass_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalClass"
      ADD CONSTRAINT "CanonicalClass_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalSubclass_rulesetId_classCode_fkey'
  ) THEN
    ALTER TABLE "CanonicalSubclass"
      ADD CONSTRAINT "CanonicalSubclass_rulesetId_classCode_fkey"
      FOREIGN KEY ("rulesetId", "classCode") REFERENCES "CanonicalClass"("rulesetId", "code")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterClassLevel_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterClassLevel"
      ADD CONSTRAINT "CharacterClassLevel_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterClassLevel_rulesetId_classCode_fkey'
  ) THEN
    ALTER TABLE "CharacterClassLevel"
      ADD CONSTRAINT "CharacterClassLevel_rulesetId_classCode_fkey"
      FOREIGN KEY ("rulesetId", "classCode") REFERENCES "CanonicalClass"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterClassLevel_rulesetId_classCode_subclassCode_fkey'
  ) THEN
    ALTER TABLE "CharacterClassLevel"
      ADD CONSTRAINT "CharacterClassLevel_rulesetId_classCode_subclassCode_fkey"
      FOREIGN KEY ("rulesetId", "classCode", "subclassCode") REFERENCES "CanonicalSubclass"("rulesetId", "classCode", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. RLS deny-by-default explícito
ALTER TABLE "CanonicalClass" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalSubclass" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CharacterClassLevel" ENABLE ROW LEVEL SECURITY;
