-- ============================================================================
-- Migración: 20261007120000_add_canonical_ruleset_foundation
-- Hito: Canonical Character & Rules Database — Fase 1 (Foundation)
-- ============================================================================
--
-- Añade la infraestructura relacional de reglas canónicas con aislamiento estricto
-- por edición de reglas (Ruleset), trazabilidad de fuentes (RuleSource) y catálogos
-- fundacionales inmutables (CanonicalAbility, CanonicalSkill, CanonicalLanguage).
--
-- 1. "Ruleset":
--    Identificador inmutable del sistema de reglas (e.g. "dnd_5e_2014", "dnd_5e_2024").
--    Garantiza que una campaña 2014 nunca consuma reglas 2024 por colisión de slugs.
-- 2. "RuleSource":
--    Documento legal / fuente autoritativa (e.g. "srd_5_1", licencia CC-BY-4.0).
-- 3. "CanonicalAbility":
--    Las 6 características primarias ("STR", "DEX", "CON", "INT", "WIS", "CHA")
--    con clave compuesta ("rulesetId", "code").
-- 4. "CanonicalSkill":
--    Las 18 habilidades oficiales del SRD vinculadas a su característica dentro del
--    mismo ruleset, garantizando integridad referencial compuesta.
-- 5. "CanonicalLanguage":
--    Idiomas estándar y exóticos vinculados al ruleset.
-- 6. Row Level Security (RLS):
--    Activado en modo deny-by-default para todas las tablas nuevas, de acuerdo con
--    el contrato de seguridad de tests/architecture/rls-deny-by-default.test.ts.
--
-- ADITIVA Y SEGURA:
-- No modifica, bloquea ni elimina ninguna columna ni tabla preexistente.
-- Las tablas de partidas ("Character", "Campaign", "Combatant", "User") quedan
-- 100% intactas.
--
-- ORDEN DE DESPLIEGUE:
-- Esta migración es independiente de las rutas de usuario activas. Puede aplicarse
-- antes o después del despliegue de la aplicación sin impacto en tiempo de ejecución.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RulesetStatus') THEN
    CREATE TYPE "RulesetStatus" AS ENUM ('ACTIVE', 'DRAFT', 'DEPRECATED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LanguageType') THEN
    CREATE TYPE "LanguageType" AS ENUM ('STANDARD', 'EXOTIC');
  END IF;
END $$;

-- 1. Tabla Ruleset
CREATE TABLE IF NOT EXISTS "Ruleset" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "RulesetStatus" NOT NULL DEFAULT 'ACTIVE'::"RulesetStatus",
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ruleset_pkey" PRIMARY KEY ("id")
);

-- 2. Tabla RuleSource
CREATE TABLE IF NOT EXISTS "RuleSource" (
  "id" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "publisher" TEXT NOT NULL,
  "url" TEXT,
  "license" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuleSource_pkey" PRIMARY KEY ("id")
);

-- 3. Tabla CanonicalAbility
CREATE TABLE IF NOT EXISTS "CanonicalAbility" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CanonicalAbility_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 4. Tabla CanonicalSkill
CREATE TABLE IF NOT EXISTS "CanonicalSkill" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "abilityCode" TEXT NOT NULL,
  CONSTRAINT "CanonicalSkill_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 5. Tabla CanonicalLanguage
CREATE TABLE IF NOT EXISTS "CanonicalLanguage" (
  "rulesetId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "LanguageType" NOT NULL DEFAULT 'STANDARD'::"LanguageType",
  "script" TEXT,
  CONSTRAINT "CanonicalLanguage_pkey" PRIMARY KEY ("rulesetId", "code")
);

-- 6. Índices y restricciones de unicidad
CREATE UNIQUE INDEX IF NOT EXISTS "RuleSource_rulesetId_code_key" ON "RuleSource"("rulesetId", "code");
CREATE INDEX IF NOT EXISTS "RuleSource_rulesetId_idx" ON "RuleSource"("rulesetId");
CREATE INDEX IF NOT EXISTS "CanonicalAbility_rulesetId_idx" ON "CanonicalAbility"("rulesetId");
CREATE INDEX IF NOT EXISTS "CanonicalSkill_rulesetId_abilityCode_idx" ON "CanonicalSkill"("rulesetId", "abilityCode");
CREATE INDEX IF NOT EXISTS "CanonicalLanguage_rulesetId_idx" ON "CanonicalLanguage"("rulesetId");

-- 7. Claves Foráneas con comprobación de existencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleSource_rulesetId_fkey'
  ) THEN
    ALTER TABLE "RuleSource"
      ADD CONSTRAINT "RuleSource_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalAbility_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalAbility"
      ADD CONSTRAINT "CanonicalAbility_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalSkill_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalSkill"
      ADD CONSTRAINT "CanonicalSkill_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalSkill_rulesetId_abilityCode_fkey'
  ) THEN
    ALTER TABLE "CanonicalSkill"
      ADD CONSTRAINT "CanonicalSkill_rulesetId_abilityCode_fkey"
      FOREIGN KEY ("rulesetId", "abilityCode") REFERENCES "CanonicalAbility"("rulesetId", "code")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CanonicalLanguage_rulesetId_fkey'
  ) THEN
    ALTER TABLE "CanonicalLanguage"
      ADD CONSTRAINT "CanonicalLanguage_rulesetId_fkey"
      FOREIGN KEY ("rulesetId") REFERENCES "Ruleset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 8. RLS deny-by-default explícito
ALTER TABLE "Ruleset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RuleSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalAbility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalSkill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalLanguage" ENABLE ROW LEVEL SECURITY;
