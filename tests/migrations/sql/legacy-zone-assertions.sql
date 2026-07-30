DO $$
BEGIN
  IF to_regclass('"Zone"') IS NOT NULL THEN
    RAISE EXCEPTION 'Zone table still exists after migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Combatant'
      AND column_name = 'zoneId'
  ) THEN
    RAISE EXCEPTION 'Combatant.zoneId still exists after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Combatant"
    WHERE "id" = 'combatant-a' AND "x" = 2 AND "y" = 3
  ) THEN
    RAISE EXCEPTION 'combatant-a did not inherit zone-a coordinates';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Combatant"
    WHERE "id" = 'combatant-b' AND "x" = 12 AND "y" = 11
  ) THEN
    RAISE EXCEPTION 'combatant-b did not inherit zone-b coordinates';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Combatant"
    WHERE "id" = 'combatant-free' AND "x" = 6 AND "y" = 7
  ) THEN
    RAISE EXCEPTION 'combatant without a zone did not preserve explicit coordinates';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "EncounterMap"
    WHERE "encounterId" = 'encounter-legacy'
      AND "width" >= 14
      AND "height" >= 13
  ) THEN
    RAISE EXCEPTION 'EncounterMap dimensions do not include migrated footprints';
  END IF;
END
$$;
