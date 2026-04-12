-- Migration: ephemeral combat zone grid (Milestone H Slice 5)

-- Zone table: scoped to Encounter, cascades on delete.
CREATE TABLE "Zone" (
  "id"          TEXT        NOT NULL,
  "encounterId" TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "x"           INTEGER     NOT NULL,
  "y"           INTEGER     NOT NULL,
  CONSTRAINT "Zone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Zone_encounterId_fkey"
    FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Zone_encounterId_idx" ON "Zone"("encounterId");

-- Add zoneId FK to Combatant (nullable — zone system is opt-in per encounter).
ALTER TABLE "Combatant" ADD COLUMN "zoneId" TEXT;

ALTER TABLE "Combatant"
  ADD CONSTRAINT "Combatant_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "Zone"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
