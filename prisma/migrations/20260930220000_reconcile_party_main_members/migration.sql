-- Repair campaigns accepted by old application instances after the original
-- PartyMember backfill. Apply only after pausing writes and draining all old
-- instances, before starting the application that creates MAIN atomically.
-- Do not edit the already-applied 20260917130000 migration or its checksum.
-- Existing control modes, companion memberships and timestamps stay intact.
DO $reconcile_party_main_members$
BEGIN
  INSERT INTO "PartyMember" ("id", "campaignId", "characterId", "role", "control", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    "Campaign"."id",
    "Campaign"."characterId",
    'MAIN',
    'USER',
    "Campaign"."createdAt",
    "Campaign"."createdAt"
  FROM "Campaign"
  ON CONFLICT ("campaignId", "characterId") DO NOTHING;

  -- A conflicting COMPANION row for the current character would make the
  -- INSERT skip that campaign. Abort the entire batch instead of silently
  -- retaining a missing MAIN; a different existing MAIN already fails the
  -- partial unique index. Neither case is repaired by overwriting player data.
  IF EXISTS (
    SELECT 1 FROM "Campaign"
    WHERE NOT EXISTS (
      SELECT 1 FROM "PartyMember"
      WHERE "PartyMember"."campaignId" = "Campaign"."id"
        AND "PartyMember"."characterId" = "Campaign"."characterId"
        AND "PartyMember"."role" = 'MAIN'
    )
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile party MAIN memberships: current campaign character is not MAIN; inspect existing memberships';
  END IF;
END
$reconcile_party_main_members$;
