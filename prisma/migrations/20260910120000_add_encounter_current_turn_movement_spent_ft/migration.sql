-- Adds the backend-authoritative movement expenditure for Encounter's current
-- round/currentTurnIndex identity. The canonical unit is integer feet.
--
-- ADDITIVE, NULLABLE, AND WITHOUT DEFAULT. Existing active encounters have
-- unknown current-turn history, so this migration must not invent a zero spend
-- for them. Production fails closed on NULL; the next successful non-terminal
-- turn transition canonicalizes the new turn to 0 in the same Encounter CAS.
-- New encounter writers explicitly initialize the field to 0.
--
-- No UPDATE/backfill is intentional. No index is needed: every budget claim is
-- already scoped by Encounter's primary key. The CHECK preserves NULL legacy
-- semantics while preventing any authoritative write from storing a negative
-- expenditure.
DO $add_encounter_current_turn_movement_spent_ft$
BEGIN
  EXECUTE 'ALTER TABLE "Encounter" ADD COLUMN IF NOT EXISTS "currentTurnMovementSpentFt" INTEGER';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Encounter_currentTurnMovementSpentFt_nonnegative_check'
      AND conrelid = '"Encounter"'::regclass
  ) THEN
    ALTER TABLE "Encounter"
      ADD CONSTRAINT "Encounter_currentTurnMovementSpentFt_nonnegative_check"
      CHECK (
        "currentTurnMovementSpentFt" IS NULL
        OR "currentTurnMovementSpentFt" >= 0
      );
  END IF;
END
$add_encounter_current_turn_movement_spent_ft$;
