-- Recovered from the applied Supabase migration record (version 20260505050947).
-- Idempotent so fresh databases and the already-patched database reach the same state.
ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "actionBudget" JSONB;
