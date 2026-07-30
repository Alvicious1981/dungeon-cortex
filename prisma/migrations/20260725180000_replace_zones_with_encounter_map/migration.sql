-- Milestone V: replace per-cell Zone persistence with one authoritative map.
-- Legacy Zone coordinates are copied into Combatant.x/y before zone references
-- are removed. The migration aborts if a referenced Zone cannot be resolved.

CREATE TYPE "GridType" AS ENUM ('SQUARE', 'HEX');

CREATE TABLE "EncounterMap" (
  "id"          TEXT       NOT NULL,
  "encounterId" TEXT       NOT NULL,
  "gridType"    "GridType" NOT NULL DEFAULT 'SQUARE',
  "width"       INTEGER    NOT NULL DEFAULT 10,
  "height"      INTEGER    NOT NULL DEFAULT 10,
  "cellSize"    INTEGER    NOT NULL DEFAULT 5,

  CONSTRAINT "EncounterMap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EncounterMap_positive_dimensions_check"
    CHECK ("width" > 0 AND "height" > 0 AND "cellSize" > 0)
);

CREATE UNIQUE INDEX "EncounterMap_encounterId_key"
  ON "EncounterMap"("encounterId");

ALTER TABLE "EncounterMap"
  ADD CONSTRAINT "EncounterMap_encounterId_fkey"
  FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Refuse to discard a zone reference that cannot be translated into grid
-- coordinates. This is intentionally fail-fast and non-destructive.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Combatant" c
    LEFT JOIN "Zone" z ON z."id" = c."zoneId"
    WHERE c."zoneId" IS NOT NULL
      AND z."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot replace Zone persistence: at least one Combatant.zoneId references a missing Zone';
  END IF;
END
$$;

-- Zone was the legacy spatial authority whenever zoneId was present. Copy its
-- coordinates before creating map dimensions or dropping the relation.
UPDATE "Combatant" c
SET
  "x" = z."x",
  "y" = z."y"
FROM "Zone" z
WHERE c."zoneId" = z."id";

-- Backfill one map for every encounter. Ten cells preserves the current VTT
-- projection; larger persisted footprints expand the corresponding axis.
INSERT INTO "EncounterMap" (
  "id",
  "encounterId",
  "gridType",
  "width",
  "height",
  "cellSize"
)
SELECT
  CONCAT('map_', e."id"),
  e."id",
  'SQUARE'::"GridType",
  GREATEST(
    10,
    COALESCE(MAX(z."x") + 1, 0),
    COALESCE(MAX(c."x" + CASE LOWER(c."size")
      WHEN 'large' THEN 2
      WHEN 'huge' THEN 3
      WHEN 'gargantuan' THEN 4
      ELSE 1
    END), 0)
  ),
  GREATEST(
    10,
    COALESCE(MAX(z."y") + 1, 0),
    COALESCE(MAX(c."y" + CASE LOWER(c."size")
      WHEN 'large' THEN 2
      WHEN 'huge' THEN 3
      WHEN 'gargantuan' THEN 4
      ELSE 1
    END), 0)
  ),
  5
FROM "Encounter" e
LEFT JOIN "Zone" z ON z."encounterId" = e."id"
LEFT JOIN "Combatant" c ON c."encounterId" = e."id"
GROUP BY e."id";

ALTER TABLE "Combatant"
  DROP CONSTRAINT IF EXISTS "Combatant_zoneId_fkey";

DROP INDEX IF EXISTS "Combatant_encounterId_zoneId_idx";

ALTER TABLE "Combatant"
  DROP COLUMN IF EXISTS "zoneId";

DROP TABLE "Zone";
