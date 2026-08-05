-- Reconciles verified non-legacy schema drift without deleting remote state.
-- Do not add CampaignTime, PartyInventory, WildernessMap, TravelState, Haven,
-- or Retainer here: they are excluded pending a separate 5e/SRD 2014 decision.
-- This migration is additive and preserves existing action-budget/death-save data.
-- QA recovery migration: reconcile_nonlegacy_schema_drift
-- Allowed tables: "Campaign", "Character", "Combatant", "Encounter",
-- "InventoryItem", "NPC", "Zone", "SrdCondition", "SrdEquipment".
-- The six preserved retro structures are deliberately excluded.

BEGIN;

ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "currentLocationId" TEXT,
  ADD COLUMN IF NOT EXISTS "currentNodeId" TEXT,
  ADD COLUMN IF NOT EXISTS "gold" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Character"
  ADD COLUMN IF NOT EXISTS "exhaustionLevel" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "hitDiceRemaining" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "hitDiceTotal" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Combatant"
  ADD COLUMN IF NOT EXISTS "concentrationSpellId" TEXT,
  ADD COLUMN IF NOT EXISTS "size" TEXT NOT NULL DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS "stats" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "x" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "y" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deathSaveSuccesses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deathSaveFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "actionBudget" JSONB;

ALTER TABLE "Encounter"
  ADD COLUMN IF NOT EXISTS "totalDamageDealt" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "InventoryItem"
  ADD COLUMN IF NOT EXISTS "indexSlug" TEXT;

ALTER TABLE "NPC"
  ADD COLUMN IF NOT EXISTS "concentrationSpellId" TEXT,
  ADD COLUMN IF NOT EXISTS "disposition" INTEGER,
  ADD COLUMN IF NOT EXISTS "hasMetPlayer" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "knownRumors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "personalityTags" JSONB;

ALTER TABLE "Zone"
  ALTER COLUMN "x" SET DEFAULT 0,
  ALTER COLUMN "y" SET DEFAULT 0;

CREATE TABLE IF NOT EXISTS "SrdCondition" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "indexSlug" TEXT NOT NULL,
  "desc" TEXT,
  "data" JSONB NOT NULL,

  CONSTRAINT "SrdCondition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SrdEquipment" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "indexSlug" TEXT,
  "equipmentCategory" TEXT,
  "weaponCategory" TEXT,
  "weaponRange" TEXT,
  "categoryRange" TEXT,
  "costQuantity" INTEGER,
  "costUnit" TEXT,
  "weight" DOUBLE PRECISION,
  "damageDice" TEXT,
  "damageType" TEXT,
  "twoHandedDamageDice" TEXT,
  "twoHandedDamageType" TEXT,
  "rangeNormal" INTEGER,
  "rangeLong" INTEGER,
  "armorCategory" TEXT,
  "armorClassBase" INTEGER,
  "armorClassDexBonus" BOOLEAN,
  "armorClassMaxBonus" INTEGER,
  "strMinimum" INTEGER,
  "stealthDisadvantage" BOOLEAN,
  "desc" TEXT,
  "properties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "data" JSONB NOT NULL,

  CONSTRAINT "SrdEquipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SrdCondition_indexSlug_key"
  ON "SrdCondition"("indexSlug");
CREATE INDEX IF NOT EXISTS "SrdCondition_indexSlug_idx"
  ON "SrdCondition"("indexSlug");
CREATE INDEX IF NOT EXISTS "SrdEquipment_indexSlug_idx"
  ON "SrdEquipment"("indexSlug");
CREATE INDEX IF NOT EXISTS "SrdEquipment_equipmentCategory_idx"
  ON "SrdEquipment"("equipmentCategory");
CREATE INDEX IF NOT EXISTS "SrdEquipment_weaponCategory_idx"
  ON "SrdEquipment"("weaponCategory");
CREATE INDEX IF NOT EXISTS "SrdEquipment_armorCategory_idx"
  ON "SrdEquipment"("armorCategory");
CREATE INDEX IF NOT EXISTS "Combatant_encounterId_zoneId_idx"
  ON "Combatant"("encounterId", "zoneId");
CREATE INDEX IF NOT EXISTS "Combatant_zoneId_idx"
  ON "Combatant"("zoneId");
CREATE UNIQUE INDEX IF NOT EXISTS "Zone_encounterId_x_y_key"
  ON "Zone"("encounterId", "x", "y");

-- QA recovery migration: reconcile_location_graph_and_campaign_position
-- Allowed tables: "Campaign", "Location", "LocationNode", "LocationEdge".
-- Existing type, index, and feature values are retained byte-for-byte.

CREATE TABLE IF NOT EXISTS "Location" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "seed" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "parentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LocationNode" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "feature" TEXT NOT NULL DEFAULT 'empty',
  "npcSeed" TEXT,
  "featureData" JSONB NOT NULL DEFAULT '{}',
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,

  CONSTRAINT "LocationNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LocationEdge" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "fromNodeId" TEXT NOT NULL,
  "toNodeId" TEXT NOT NULL,
  "passageType" TEXT NOT NULL DEFAULT 'open',

  CONSTRAINT "LocationEdge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Location_campaignId_seed_key"
  ON "Location"("campaignId", "seed");
CREATE UNIQUE INDEX IF NOT EXISTS "Location_id_campaignId_key"
  ON "Location"("id", "campaignId");
CREATE INDEX IF NOT EXISTS "Location_campaignId_idx"
  ON "Location"("campaignId");
CREATE UNIQUE INDEX IF NOT EXISTS "LocationNode_locationId_index_key"
  ON "LocationNode"("locationId", "index");
CREATE UNIQUE INDEX IF NOT EXISTS "LocationNode_id_locationId_key"
  ON "LocationNode"("id", "locationId");
CREATE INDEX IF NOT EXISTS "LocationNode_locationId_idx"
  ON "LocationNode"("locationId");
CREATE UNIQUE INDEX IF NOT EXISTS "LocationEdge_fromNodeId_toNodeId_key"
  ON "LocationEdge"("fromNodeId", "toNodeId");
CREATE INDEX IF NOT EXISTS "LocationEdge_locationId_idx"
  ON "LocationEdge"("locationId");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Location" AS child
    JOIN "Location" AS parent ON parent."id" = child."parentId"
    WHERE child."campaignId" <> parent."campaignId"
  ) THEN
    RAISE EXCEPTION 'Location parent belongs to another campaign';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "LocationEdge" AS edge
    LEFT JOIN "LocationNode" AS source
      ON source."id" = edge."fromNodeId"
      AND source."locationId" = edge."locationId"
    LEFT JOIN "LocationNode" AS target
      ON target."id" = edge."toNodeId"
      AND target."locationId" = edge."locationId"
    WHERE source."id" IS NULL OR target."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'LocationEdge references a node outside its location';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Campaign" AS campaign
    LEFT JOIN "Location" AS location
      ON location."id" = campaign."currentLocationId"
      AND location."campaignId" = campaign."id"
    LEFT JOIN "LocationNode" AS node
      ON node."id" = campaign."currentNodeId"
      AND node."locationId" = campaign."currentLocationId"
    WHERE
      (campaign."currentNodeId" IS NOT NULL AND campaign."currentLocationId" IS NULL)
      OR (campaign."currentLocationId" IS NOT NULL AND location."id" IS NULL)
      OR (campaign."currentNodeId" IS NOT NULL AND node."id" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Campaign position is outside its campaign/location';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Location_campaignId_fkey' AND conrelid = '"Location"'::regclass
  ) THEN
    ALTER TABLE "Location"
      ADD CONSTRAINT "Location_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Location_parentId_campaignId_fkey' AND conrelid = '"Location"'::regclass
  ) THEN
    ALTER TABLE "Location"
      ADD CONSTRAINT "Location_parentId_campaignId_fkey"
      FOREIGN KEY ("parentId", "campaignId")
      REFERENCES "Location"("id", "campaignId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LocationNode_locationId_fkey' AND conrelid = '"LocationNode"'::regclass
  ) THEN
    ALTER TABLE "LocationNode"
      ADD CONSTRAINT "LocationNode_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "Location"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LocationEdge_locationId_fkey' AND conrelid = '"LocationEdge"'::regclass
  ) THEN
    ALTER TABLE "LocationEdge"
      ADD CONSTRAINT "LocationEdge_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "Location"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LocationEdge_fromNodeId_locationId_fkey' AND conrelid = '"LocationEdge"'::regclass
  ) THEN
    ALTER TABLE "LocationEdge"
      ADD CONSTRAINT "LocationEdge_fromNodeId_locationId_fkey"
      FOREIGN KEY ("fromNodeId", "locationId")
      REFERENCES "LocationNode"("id", "locationId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LocationEdge_toNodeId_locationId_fkey' AND conrelid = '"LocationEdge"'::regclass
  ) THEN
    ALTER TABLE "LocationEdge"
      ADD CONSTRAINT "LocationEdge_toNodeId_locationId_fkey"
      FOREIGN KEY ("toNodeId", "locationId")
      REFERENCES "LocationNode"("id", "locationId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LocationEdge_distinct_nodes_check' AND conrelid = '"LocationEdge"'::regclass
  ) THEN
    ALTER TABLE "LocationEdge"
      ADD CONSTRAINT "LocationEdge_distinct_nodes_check"
      CHECK ("fromNodeId" <> "toNodeId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Campaign_current_position_pair_check' AND conrelid = '"Campaign"'::regclass
  ) THEN
    ALTER TABLE "Campaign"
      ADD CONSTRAINT "Campaign_current_position_pair_check"
      CHECK ("currentNodeId" IS NULL OR "currentLocationId" IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Campaign_currentLocationId_id_fkey' AND conrelid = '"Campaign"'::regclass
  ) THEN
    ALTER TABLE "Campaign"
      ADD CONSTRAINT "Campaign_currentLocationId_id_fkey"
      FOREIGN KEY ("currentLocationId", "id")
      REFERENCES "Location"("id", "campaignId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Campaign_currentNodeId_currentLocationId_fkey' AND conrelid = '"Campaign"'::regclass
  ) THEN
    ALTER TABLE "Campaign"
      ADD CONSTRAINT "Campaign_currentNodeId_currentLocationId_fkey"
      FOREIGN KEY ("currentNodeId", "currentLocationId")
      REFERENCES "LocationNode"("id", "locationId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
COMMIT;
