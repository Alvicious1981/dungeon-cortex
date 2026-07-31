-- Enforce the invariant that one campaign can have at most one open session.
-- An open session is ACTIVE or PAUSED. COMPLETED sessions remain unlimited.
--
-- This migration is intentionally fail-fast: if legacy duplicates exist, stop
-- and reconcile them manually before deployment rather than choosing a winner.
-- Rollback: DROP INDEX "GameSession_one_open_per_campaign_key";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "GameSession"
    WHERE "status" IN ('ACTIVE', 'PAUSED')
    GROUP BY "campaignId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one open session per campaign: duplicate ACTIVE/PAUSED sessions exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX "GameSession_one_open_per_campaign_key"
ON "GameSession" ("campaignId")
WHERE "status" IN ('ACTIVE', 'PAUSED');
