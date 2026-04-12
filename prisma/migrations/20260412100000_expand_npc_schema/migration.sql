-- Migration: expand NPC model with rich procedural generation fields (Milestone I Slice 3)

ALTER TABLE "NPC" ADD COLUMN "race"          TEXT;
ALTER TABLE "NPC" ADD COLUMN "profession"    TEXT;
ALTER TABLE "NPC" ADD COLUMN "alignment"     TEXT;
ALTER TABLE "NPC" ADD COLUMN "abilityScores" JSONB;
ALTER TABLE "NPC" ADD COLUMN "traits"        JSONB;
