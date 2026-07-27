-- Reconcile schema objects previously introduced through db push but never versioned.
-- Additive only: preserve existing performance/HNSW indexes and do not install
-- optional deployment-specific extensions that are unused by these models.

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "currentLocationId" TEXT,
ADD COLUMN     "currentNodeId" TEXT,
ADD COLUMN     "gold" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "exhaustionLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hitDiceRemaining" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "hitDiceTotal" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Combatant" ADD COLUMN     "concentrationSpellId" TEXT,
ADD COLUMN     "size" TEXT NOT NULL DEFAULT 'Medium',
ADD COLUMN     "stats" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "x" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "y" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Encounter" ADD COLUMN     "totalDamageDealt" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "indexSlug" TEXT;

-- AlterTable
ALTER TABLE "NPC" ADD COLUMN     "concentrationSpellId" TEXT,
ADD COLUMN     "disposition" INTEGER,
ADD COLUMN     "hasMetPlayer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "knownRumors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "personalityTags" JSONB;

-- AlterTable
ALTER TABLE "Zone" ALTER COLUMN "x" SET DEFAULT 0,
ALTER COLUMN "y" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "SrdCondition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "indexSlug" TEXT NOT NULL,
    "desc" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "SrdCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SrdEquipment" (
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
    "properties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "data" JSONB NOT NULL,

    CONSTRAINT "SrdEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
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

-- CreateTable
CREATE TABLE "LocationNode" (
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

-- CreateTable
CREATE TABLE "LocationEdge" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "passageType" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "LocationEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTime" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "totalHours" INTEGER NOT NULL DEFAULT 0,
    "totalDays" INTEGER NOT NULL DEFAULT 0,
    "turnsSinceRest" INTEGER NOT NULL DEFAULT 0,
    "turnsSinceEncounterCheck" INTEGER NOT NULL DEFAULT 0,
    "turnsSinceRation" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyInventory" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "torches" INTEGER NOT NULL DEFAULT 0,
    "oilFlasks" INTEGER NOT NULL DEFAULT 0,
    "rations" INTEGER NOT NULL DEFAULT 0,
    "activeLightSource" TEXT NOT NULL DEFAULT 'none',
    "lightSourceTurnsRemaining" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildernessMap" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "terrain" TEXT NOT NULL,
    "biome" TEXT NOT NULL,
    "elevation" INTEGER NOT NULL DEFAULT 0,
    "moisture" INTEGER NOT NULL DEFAULT 0,
    "discovered" BOOLEAN NOT NULL DEFAULT false,
    "scouted" BOOLEAN NOT NULL DEFAULT false,
    "feature" TEXT,
    "locationId" TEXT,
    "seed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WildernessMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelState" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "currentQ" INTEGER NOT NULL DEFAULT 0,
    "currentR" INTEGER NOT NULL DEFAULT 0,
    "currentWatch" INTEGER NOT NULL DEFAULT 0,
    "totalWatches" INTEGER NOT NULL DEFAULT 0,
    "totalDays" INTEGER NOT NULL DEFAULT 0,
    "watchesTraveledToday" INTEGER NOT NULL DEFAULT 0,
    "watchesSinceRation" INTEGER NOT NULL DEFAULT 0,
    "weatherWatchCounter" INTEGER NOT NULL DEFAULT 0,
    "partialHexProgress" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "partyPace" TEXT NOT NULL DEFAULT 'normal',
    "weatherCondition" TEXT NOT NULL DEFAULT 'clear',
    "weatherIntensity" INTEGER NOT NULL DEFAULT 0,
    "seasonIndex" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Haven" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prosperityLevel" INTEGER NOT NULL DEFAULT 1,
    "baseUpkeepCost" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Haven_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Retainer" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "wage" INTEGER NOT NULL DEFAULT 5,
    "loyaltyScore" INTEGER NOT NULL DEFAULT 7,
    "moraleState" TEXT NOT NULL DEFAULT 'confident',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Retainer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SrdCondition_indexSlug_key" ON "SrdCondition"("indexSlug");

-- CreateIndex
CREATE INDEX "SrdCondition_indexSlug_idx" ON "SrdCondition"("indexSlug");

-- CreateIndex
CREATE INDEX "SrdEquipment_indexSlug_idx" ON "SrdEquipment"("indexSlug");

-- CreateIndex
CREATE INDEX "SrdEquipment_equipmentCategory_idx" ON "SrdEquipment"("equipmentCategory");

-- CreateIndex
CREATE INDEX "SrdEquipment_weaponCategory_idx" ON "SrdEquipment"("weaponCategory");

-- CreateIndex
CREATE INDEX "SrdEquipment_armorCategory_idx" ON "SrdEquipment"("armorCategory");

-- CreateIndex
CREATE INDEX "Location_campaignId_idx" ON "Location"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_campaignId_seed_key" ON "Location"("campaignId", "seed");

-- CreateIndex
CREATE INDEX "LocationNode_locationId_idx" ON "LocationNode"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationNode_locationId_index_key" ON "LocationNode"("locationId", "index");

-- CreateIndex
CREATE INDEX "LocationEdge_locationId_idx" ON "LocationEdge"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationEdge_fromNodeId_toNodeId_key" ON "LocationEdge"("fromNodeId", "toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTime_campaignId_key" ON "CampaignTime"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyInventory_campaignId_key" ON "PartyInventory"("campaignId");

-- CreateIndex
CREATE INDEX "WildernessMap_campaignId_idx" ON "WildernessMap"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "WildernessMap_campaignId_q_r_key" ON "WildernessMap"("campaignId", "q", "r");

-- CreateIndex
CREATE UNIQUE INDEX "TravelState_campaignId_key" ON "TravelState"("campaignId");

-- CreateIndex
CREATE INDEX "Haven_campaignId_idx" ON "Haven"("campaignId");

-- CreateIndex
CREATE INDEX "Retainer_campaignId_idx" ON "Retainer"("campaignId");

-- CreateIndex
CREATE INDEX "Combatant_encounterId_zoneId_idx" ON "Combatant"("encounterId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_encounterId_x_y_key" ON "Zone"("encounterId", "x", "y");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationNode" ADD CONSTRAINT "LocationNode_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEdge" ADD CONSTRAINT "LocationEdge_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEdge" ADD CONSTRAINT "LocationEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEdge" ADD CONSTRAINT "LocationEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTime" ADD CONSTRAINT "CampaignTime_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyInventory" ADD CONSTRAINT "PartyInventory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildernessMap" ADD CONSTRAINT "WildernessMap_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelState" ADD CONSTRAINT "TravelState_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Haven" ADD CONSTRAINT "Haven_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retainer" ADD CONSTRAINT "Retainer_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
