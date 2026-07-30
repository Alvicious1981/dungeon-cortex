CREATE TABLE "Encounter" (
  "id" TEXT NOT NULL,
  CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Zone" (
  "id" TEXT NOT NULL,
  "encounterId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "x" INTEGER NOT NULL DEFAULT 0,
  "y" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Combatant" (
  "id" TEXT NOT NULL,
  "encounterId" TEXT NOT NULL,
  "zoneId" TEXT,
  "size" TEXT NOT NULL DEFAULT 'Medium',
  "x" INTEGER NOT NULL DEFAULT 0,
  "y" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Combatant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Combatant_encounterId_zoneId_idx"
  ON "Combatant"("encounterId", "zoneId");

INSERT INTO "Encounter" ("id") VALUES ('encounter-orphan');
INSERT INTO "Combatant" ("id", "encounterId", "zoneId")
VALUES ('combatant-orphan', 'encounter-orphan', 'missing-zone');
