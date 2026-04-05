-- AlterTable: add spatial zone graph to Encounter
ALTER TABLE "Encounter" ADD COLUMN "zones" JSONB NOT NULL DEFAULT '[]';

-- AlterTable: track current zone for each Combatant (nullable — null = no zone tracking)
ALTER TABLE "Combatant" ADD COLUMN "currentZoneId" TEXT;
