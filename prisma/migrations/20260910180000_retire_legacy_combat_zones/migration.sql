-- DC-PLAN-014E2: retire the orphaned Zone persistence contract.
--
-- DESTRUCTIVE AND ORDERED:
--   1. Deploy DC-PLAN-014E1 and drain pre-014E1 Zone writers.
--   2. Deploy the 014E2 application/client while the old schema still exists.
--      It is backward-compatible because it ignores the extra Zone objects.
--   3. Drain every 014E1 and older instance. Their generated Prisma clients can
--      still select zoneId even on code paths that do not write it.
--   4. Only then apply this migration.
--
-- Combatant.x/y already owns current mechanical position. A moved combatant's
-- zoneId was deliberately not updated, so a coordinate mismatch is stale
-- legacy linkage rather than an alternate position to preserve. The guards
-- below instead prove every Zone row has the exact synthetic shape emitted by
-- the retired writer. Any custom name, coordinate, partial layout, or
-- cross-encounter link aborts before any DROP and requires manual review.
--
-- The DO block is one PostgreSQL statement: guard failures and DDL are atomic
-- even under an autocommit migration runner. DROP TABLE intentionally omits
-- CASCADE so an unknown dependent object also fails closed.
DO $retire_legacy_combat_zones$
DECLARE
  unexpected_zone_rows BIGINT;
  unexpected_layouts BIGINT;
  orphan_zone_links BIGINT;
  cross_encounter_links BIGINT;
  zone_id_column_exists BOOLEAN;
BEGIN
  -- Close the validation-to-drop race even after the rollout drain. The order
  -- matches the retired encounter writer (Zone first, then Combatant), so an
  -- in-flight old transaction is allowed to finish before guards inspect it.
  IF to_regclass('"Zone"') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE "Zone" IN ACCESS EXCLUSIVE MODE';
  END IF;

  IF to_regclass('"Combatant"') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE "Combatant" IN ACCESS EXCLUSIVE MODE';
  END IF;

  IF to_regclass('"Zone"') IS NOT NULL THEN
    SELECT COUNT(*)
      INTO unexpected_zone_rows
      FROM "Zone"
     WHERE "name" IS NULL
        OR "x" IS NULL
        OR "y" IS NULL
        OR "name" <> format('z_%s_%s', "x", "y")
        OR "x" < 0
        OR "y" < 0
        OR "x" > 4
        OR "y" > 4;

    IF unexpected_zone_rows > 0 THEN
      RAISE EXCEPTION
        'Unexpected legacy Zone data: % row(s) are not synthetic 3x3/5x5 grid cells; refusing retirement',
        unexpected_zone_rows;
    END IF;

    SELECT COUNT(*)
      INTO unexpected_layouts
      FROM (
        SELECT "encounterId"
          FROM "Zone"
         GROUP BY "encounterId"
        HAVING NOT (
          COUNT(*) = 9
          AND MIN("x") = 0
          AND MAX("x") = 2
          AND MIN("y") = 0
          AND MAX("y") = 2
          AND COUNT(DISTINCT ("x", "y")) = 9
        )
        AND NOT (
          COUNT(*) = 25
          AND MIN("x") = 0
          AND MAX("x") = 4
          AND MIN("y") = 0
          AND MAX("y") = 4
          AND COUNT(DISTINCT ("x", "y")) = 25
        )
      ) AS invalid_layout;

    IF unexpected_layouts > 0 THEN
      RAISE EXCEPTION
        'Unexpected legacy Zone layout: % encounter(s) are not complete synthetic 3x3/5x5 grids; refusing retirement',
        unexpected_layouts;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'Combatant'
       AND column_name = 'zoneId'
  ) INTO zone_id_column_exists;

  IF zone_id_column_exists THEN
    IF to_regclass('"Zone"') IS NOT NULL THEN
      EXECUTE
        'SELECT COUNT(*) FROM "Combatant" c LEFT JOIN "Zone" z ON z."id" = c."zoneId" WHERE c."zoneId" IS NOT NULL AND z."id" IS NULL'
        INTO orphan_zone_links;

      EXECUTE
        'SELECT COUNT(*) FROM "Combatant" c JOIN "Zone" z ON z."id" = c."zoneId" WHERE c."encounterId" <> z."encounterId"'
        INTO cross_encounter_links;
    ELSE
      EXECUTE
        'SELECT COUNT(*) FROM "Combatant" WHERE "zoneId" IS NOT NULL'
        INTO orphan_zone_links;
      cross_encounter_links := 0;
    END IF;

    IF orphan_zone_links > 0 THEN
      RAISE EXCEPTION
        'Orphaned Combatant.zoneId relation: % row(s); refusing retirement',
        orphan_zone_links;
    END IF;

    IF cross_encounter_links > 0 THEN
      RAISE EXCEPTION
        'Cross-encounter Combatant.zoneId relation: % row(s); refusing retirement',
        cross_encounter_links;
    END IF;
  END IF;

  IF to_regclass('"Combatant"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "Combatant" DROP CONSTRAINT IF EXISTS "Combatant_zoneId_fkey"';
    EXECUTE 'DROP INDEX IF EXISTS "Combatant_encounterId_zoneId_idx"';
    EXECUTE 'DROP INDEX IF EXISTS "Combatant_zoneId_idx"';
    EXECUTE 'ALTER TABLE "Combatant" DROP COLUMN IF EXISTS "zoneId"';
  END IF;

  EXECUTE 'DROP TABLE IF EXISTS "Zone"';
END
$retire_legacy_combat_zones$;
