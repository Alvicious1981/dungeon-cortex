-- Adds Encounter-owned object-interaction state for the active round/index.
-- ADDITIVE, NULLABLE, AND WITHOUT DEFAULT: legacy mid-turn use is unknowable,
-- so callers fail closed until a successful turn advance writes false.
-- Apply this migration before deploying the application, then drain old app
-- instances before declaring the policy live.
DO $add_current_turn_object_interaction$
BEGIN
  EXECUTE 'ALTER TABLE "Encounter" ADD COLUMN IF NOT EXISTS "currentTurnObjectInteractionUsed" BOOLEAN';
END
$add_current_turn_object_interaction$;
