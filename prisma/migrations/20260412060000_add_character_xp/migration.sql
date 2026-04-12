-- Migration: add xp field to Character (Milestone H Slice 2)
ALTER TABLE "Character" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0;
