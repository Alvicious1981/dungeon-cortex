-- Migration: expand Quest model with procedural generation fields (Milestone I Slice 5)

ALTER TABLE "Quest" ADD COLUMN "giverId"   TEXT;
ALTER TABLE "Quest" ADD COLUMN "location"  TEXT;
ALTER TABLE "Quest" ADD COLUMN "hook"      TEXT;
ALTER TABLE "Quest" ADD COLUMN "objective" TEXT;
ALTER TABLE "Quest" ADD COLUMN "reward"    TEXT;
