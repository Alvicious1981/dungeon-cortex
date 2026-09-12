-- Enforces the canonical encounter-acquisition invariant in PostgreSQL:
-- a campaign may have historical resolved/fled encounters, but at most one
-- encounter whose status is exactly "active".
--
-- Do not auto-repair existing duplicates here. If any exist, deployment must
-- fail closed so operators can inspect the conflicting combat histories.
DO $single_active_encounter$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Encounter"
    WHERE "status" = 'active'
    GROUP BY "campaignId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce single-active encounter invariant: duplicate active encounters already exist';
  END IF;
END
$single_active_encounter$;

CREATE UNIQUE INDEX "Encounter_one_active_per_campaign_key"
ON "Encounter" ("campaignId")
WHERE "status" = 'active';
