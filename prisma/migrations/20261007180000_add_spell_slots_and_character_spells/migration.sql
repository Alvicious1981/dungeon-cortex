-- ============================================================================
-- Migración: 20261007180000_add_spell_slots_and_character_spells
-- Hito: Canonical Character & Rules Database — Fase 7 (Magic & Spell Slots)
-- ============================================================================
--
-- Añade:
-- 1. "CharacterSpellSlot":
--    Estructura relacional canónica para pools de espacios de conjuro por nivel (1-9).
-- 2. "CharacterSpell":
--    Conjuros conocidos o preparados por el personaje con procedencia ("source").
-- 3. RLS deny-by-default activado explícitamente en todas las tablas nuevas.
--
-- ADITIVA Y SEGURA:
-- No modifica ni elimina ninguna columna ni tabla preexistente.
-- Preserva Character.spellSlots (JSON) y Character.concentrationSpellId para compatibilidad total.
-- ============================================================================

-- 1. Tabla CharacterSpellSlot
CREATE TABLE IF NOT EXISTS "CharacterSpellSlot" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "spellLevel" INTEGER NOT NULL,
  "maxSlots" INTEGER NOT NULL,
  "usedSlots" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterSpellSlot_pkey" PRIMARY KEY ("id")
);

-- 2. Tabla CharacterSpell
CREATE TABLE IF NOT EXISTS "CharacterSpell" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "spellSlug" TEXT NOT NULL,
  "isPrepared" BOOLEAN NOT NULL DEFAULT true,
  "isKnown" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterSpell_pkey" PRIMARY KEY ("id")
);

-- 3. Índices y restricciones de unicidad
CREATE UNIQUE INDEX IF NOT EXISTS "CharacterSpellSlot_characterId_spellLevel_key" ON "CharacterSpellSlot"("characterId", "spellLevel");
CREATE INDEX IF NOT EXISTS "CharacterSpellSlot_characterId_idx" ON "CharacterSpellSlot"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterSpellSlot_rulesetId_spellLevel_idx" ON "CharacterSpellSlot"("rulesetId", "spellLevel");

CREATE UNIQUE INDEX IF NOT EXISTS "CharacterSpell_characterId_spellSlug_key" ON "CharacterSpell"("characterId", "spellSlug");
CREATE INDEX IF NOT EXISTS "CharacterSpell_characterId_idx" ON "CharacterSpell"("characterId");
CREATE INDEX IF NOT EXISTS "CharacterSpell_rulesetId_spellSlug_idx" ON "CharacterSpell"("rulesetId", "spellSlug");

-- 4. Claves Foráneas con comprobación de existencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterSpellSlot_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterSpellSlot"
      ADD CONSTRAINT "CharacterSpellSlot_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterSpellSlot_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CharacterSpellSlot"
      ADD CONSTRAINT "CharacterSpellSlot_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterSpell_characterId_fkey'
  ) THEN
    ALTER TABLE "CharacterSpell"
      ADD CONSTRAINT "CharacterSpell_characterId_fkey"
      FOREIGN KEY ("characterId") REFERENCES "Character"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CharacterSpell_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CharacterSpell"
      ADD CONSTRAINT "CharacterSpell_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. RLS deny-by-default explícito
ALTER TABLE "CharacterSpellSlot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CharacterSpell" ENABLE ROW LEVEL SECURITY;
