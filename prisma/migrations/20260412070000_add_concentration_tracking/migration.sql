-- Migration: add concentrationSpellId to Character (Milestone H Slice 4)
ALTER TABLE "Character" ADD COLUMN "concentrationSpellId" TEXT;
