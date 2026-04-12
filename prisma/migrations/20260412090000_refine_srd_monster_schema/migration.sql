-- Migration: refine SrdMonster with explicit searchable columns (Milestone I Slice 1)

ALTER TABLE "SrdMonster" ADD COLUMN "cr"        DOUBLE PRECISION;
ALTER TABLE "SrdMonster" ADD COLUMN "type"      TEXT;
ALTER TABLE "SrdMonster" ADD COLUMN "size"      TEXT;
ALTER TABLE "SrdMonster" ADD COLUMN "alignment" TEXT;

-- Indexes for efficient CR-range and type queries used by the AI encounter builder.
CREATE INDEX "SrdMonster_cr_idx"   ON "SrdMonster"("cr");
CREATE INDEX "SrdMonster_type_idx" ON "SrdMonster"("type");
