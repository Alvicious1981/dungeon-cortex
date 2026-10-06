-- ============================================================================
-- Migración: 20261007130000_add_character_abilities_and_skills
-- Hito: Canonical Character & Rules Database — Fase 2 (Abilities & Skills)
-- ============================================================================
--
-- Normaliza las puntuaciones de característica y las competencias en habilidades
-- de "Character" en entidades relacionales ("CharacterAbility" y "CharacterSkillProficiency"),
-- vinculadas con integridad referencial compuesta a "CanonicalAbility" y "CanonicalSkill".
--
-- COEXISTENCIA Y COMPATIBILIDAD HACIA ATRÁS:
-- Las columnas legacy "Character.stats" y "Character.skillProficiencies" permanecen
-- intactas. Esta migración es estrictamente aditiva para permitir estrategia de doble
-- escritura (dual-write) antes de migrar los lectores.
--
-- RLS:
-- Activado deny-by-default en "CharacterAbility" y "CharacterSkillProficiency".
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SkillProficiencyLevel') THEN
    CREATE TYPE "SkillProficiencyLevel" AS ENUM ('PROFICIENT', 'EXPERTISE');
  END IF;
END $$;

-- 1. Tabla CharacterAbility
CREATE TABLE IF NOT EXISTS "CharacterAbility" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "abilityCode" TEXT NOT NULL,
  "baseScore" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterAbility_pkey" PRIMARY KEY ("id")
);

-- 2. Tabla CharacterSkillProficiency
CREATE TABLE IF NOT EXISTS "CharacterSkillProficiency" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "skillCode" TEXT NOT NULL,
  "level" "SkillProficiencyLevel" NOT NULL DEFAULT 'PROFICIENT'::"SkillProficiencyLevel",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterSkillProficiency_pkey" PRIMARY KEY ("id")
);

-- 3. Índices y restricciones de unicidad
CREATE UNIQUE INDEX IF NOT EXISTS "CharacterAbility_characterId_abilityCode_key" ON "CharacterAbility"("characterId", "abilityCode");
CREATE INDEX IF NOT EXISTS "CharacterAbility_characterId_idx" ON "CharacterAbility"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterAbility_rulesetId_abilityCode_idx" ON "CharacterAbility"("rulesetId", "abilityCode");

CREATE UNIQUE INDEX IF NOT EXISTS "CharacterSkillProficiency_characterId_skillCode_key" ON "CharacterSkillProficiency"("characterId", "skillCode");
CREATE INDEX IF NOT EXISTS "CharacterSkillProficiency_characterId_idx" ON "CharacterSkillProficiency"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterSkillProficiency_rulesetId_skillCode_idx" ON "CharacterSkillProficiency"("rulesetId", "skillCode");

-- 4. Claves Foráneas con comprobación de existencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterAbility_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterAbility"
      ADD CONSTRAINT "CharacterAbility_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterAbility_rulesetId_abilityCode_fkey'
  ) THEN
    ALTER TABLE "CharacterAbility"
      ADD CONSTRAINT "CharacterAbility_rulesetId_abilityCode_fkey"
      FOREIGN KEY ("rulesetId", "abilityCode") REFERENCES "CanonicalAbility"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterSkillProficiency_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterSkillProficiency"
      ADD CONSTRAINT "CharacterSkillProficiency_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterSkillProficiency_rulesetId_skillCode_fkey'
  ) THEN
    ALTER TABLE "CharacterSkillProficiency"
      ADD CONSTRAINT "CharacterSkillProficiency_rulesetId_skillCode_fkey"
      FOREIGN KEY ("rulesetId", "skillCode") REFERENCES "CanonicalSkill"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. RLS deny-by-default explícito
ALTER TABLE "CharacterAbility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CharacterSkillProficiency" ENABLE ROW LEVEL SECURITY;
