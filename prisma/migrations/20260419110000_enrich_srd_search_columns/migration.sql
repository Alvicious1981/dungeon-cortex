-- Migration: enrich SRD searchable columns (additive, backward compatible)
-- Code is Law: keep raw JSON (`data`) as canonical payload; typed columns are read-optimization only.

-- Optional extension for trigram fuzzy search on names.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- SrdMonster additive columns
-- ---------------------------------------------------------------------------
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "indexSlug" TEXT;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "subtype" TEXT;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "xp" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "proficiencyBonus" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "hitPoints" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "hitDice" TEXT;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "armorClass" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "speed" TEXT;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "languages" TEXT;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "strength" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "dexterity" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "constitution" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "intelligence" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "wisdom" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "charisma" INTEGER;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "hasLegendaryActions" BOOLEAN;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "hasSpellcasting" BOOLEAN;
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "damageImmunities" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "damageResistances" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "damageVulnerabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SrdMonster" ADD COLUMN IF NOT EXISTS "conditionImmunities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ---------------------------------------------------------------------------
-- SrdSpell additive columns
-- ---------------------------------------------------------------------------
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "indexSlug" TEXT;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "level" INTEGER;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "school" TEXT;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "castingTime" TEXT;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "range" TEXT;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "duration" TEXT;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "ritual" BOOLEAN;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "concentration" BOOLEAN;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "attackType" TEXT;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "damageType" TEXT;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "saveAbility" TEXT;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "hasHealing" BOOLEAN;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "hasAreaOfEffect" BOOLEAN;
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "classes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SrdSpell" ADD COLUMN IF NOT EXISTS "components" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ---------------------------------------------------------------------------
-- BTree indexes for exact/range filters
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "SrdMonster_size_idx" ON "SrdMonster"("size");
CREATE INDEX IF NOT EXISTS "SrdMonster_alignment_idx" ON "SrdMonster"("alignment");
CREATE INDEX IF NOT EXISTS "SrdMonster_indexSlug_idx" ON "SrdMonster"("indexSlug");
CREATE INDEX IF NOT EXISTS "SrdMonster_hasSpellcasting_idx" ON "SrdMonster"("hasSpellcasting");

CREATE INDEX IF NOT EXISTS "SrdSpell_level_idx" ON "SrdSpell"("level");
CREATE INDEX IF NOT EXISTS "SrdSpell_school_idx" ON "SrdSpell"("school");
CREATE INDEX IF NOT EXISTS "SrdSpell_ritual_idx" ON "SrdSpell"("ritual");
CREATE INDEX IF NOT EXISTS "SrdSpell_concentration_idx" ON "SrdSpell"("concentration");
CREATE INDEX IF NOT EXISTS "SrdSpell_attackType_idx" ON "SrdSpell"("attackType");
CREATE INDEX IF NOT EXISTS "SrdSpell_damageType_idx" ON "SrdSpell"("damageType");
CREATE INDEX IF NOT EXISTS "SrdSpell_saveAbility_idx" ON "SrdSpell"("saveAbility");

-- ---------------------------------------------------------------------------
-- GIN indexes for array containment lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "SrdMonster_damageImmunities_gin" ON "SrdMonster" USING GIN ("damageImmunities");
CREATE INDEX IF NOT EXISTS "SrdMonster_damageResistances_gin" ON "SrdMonster" USING GIN ("damageResistances");
CREATE INDEX IF NOT EXISTS "SrdMonster_damageVulnerabilities_gin" ON "SrdMonster" USING GIN ("damageVulnerabilities");
CREATE INDEX IF NOT EXISTS "SrdMonster_conditionImmunities_gin" ON "SrdMonster" USING GIN ("conditionImmunities");
CREATE INDEX IF NOT EXISTS "SrdSpell_classes_gin" ON "SrdSpell" USING GIN ("classes");
CREATE INDEX IF NOT EXISTS "SrdSpell_components_gin" ON "SrdSpell" USING GIN ("components");

-- Optional fuzzy search index for user-facing spell/monster name lookup.
CREATE INDEX IF NOT EXISTS "SrdMonster_name_trgm_idx" ON "SrdMonster" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "SrdSpell_name_trgm_idx" ON "SrdSpell" USING GIN ("name" gin_trgm_ops);
