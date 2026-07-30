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
  CONSTRAINT "Zone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Zone_encounterId_fkey"
    FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Zone_encounterId_x_y_key"
  ON "Zone"("encounterId", "x", "y");

CREATE TABLE "Combatant" (
  "id" TEXT NOT NULL,
  "encounterId" TEXT NOT NULL,
  "zoneId" TEXT,
  "size" TEXT NOT NULL DEFAULT 'Medium',
  "x" INTEGER NOT NULL DEFAULT 0,
  "y" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Combatant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Combatant_encounterId_fkey"
    FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Combatant_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "Zone"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Combatant_encounterId_zoneId_idx"
  ON "Combatant"("encounterId", "zoneId");

INSERT INTO "Encounter" ("id") VALUES ('encounter-legacy');

INSERT INTO "Zone" ("id", "encounterId", "name", "x", "y") VALUES
  ('zone-a', 'encounter-legacy', 'West hall', 2, 3),
  ('zone-b', 'encounter-legacy', 'East tower', 12, 11);

INSERT INTO "Combatant" ("id", "encounterId", "zoneId", "size", "x", "y") VALUES
  ('combatant-a', 'encounter-legacy', 'zone-a', 'Medium', 0, 0),
  ('combatant-b', 'encounter-legacy', 'zone-b', 'Large', 99, 99),
  ('combatant-free', 'encounter-legacy', NULL, 'Medium', 6, 7);
