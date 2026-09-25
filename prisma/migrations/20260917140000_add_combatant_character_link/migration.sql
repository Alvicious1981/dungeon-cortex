-- DC-PARTY-002: gives Combatant a durable link to the Character it
-- represents, instead of relying on isPlayer:true alone. See
-- docs/superpowers/specs/2026-09-17-combatant-character-identity-design.md.

-- Nullable, no default: enemies/NPC-derived combatants never have a
-- Character (a default here would be a false claim for every one of them).
ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "characterId" TEXT;

CREATE INDEX IF NOT EXISTS "Combatant_characterId_idx" ON "Combatant"("characterId");

ALTER TABLE "Combatant"
  ADD CONSTRAINT "Combatant_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing isPlayer:true Combatant row (historical AND
-- currently-active encounters) gets its characterId from the
-- Encounter -> Campaign -> characterId chain. Combatant only carries
-- encounterId, hence the two-hop join. This must run before any deployed
-- code starts scoping writes by characterId, or a live encounter's HP/
-- death-save/downed-state writes would silently match zero rows instead
-- of throwing (design spec §3).
UPDATE "Combatant" AS c
SET "characterId" = camp."characterId"
FROM "Encounter" AS e
JOIN "Campaign" AS camp ON camp."id" = e."campaignId"
WHERE c."encounterId" = e."id"
  AND c."isPlayer" = true
  AND c."characterId" IS NULL;

-- Every isPlayer:true Combatant carries the characterId the three player
-- write paths scope by. mirrorPlayerCombatantHp and applyPlayerDowned do not
-- check their updateMany count, so a player row without it would make them
-- silently write nothing; this CHECK turns that into a loud failure at insert
-- time instead — for any creation path, including old code still serving
-- requests between `migrate deploy` and the new code going live (design spec
-- §3). Must stay AFTER the backfill above: Postgres validates a new CHECK
-- against every existing row, and before the backfill the pre-existing player
-- rows still have a NULL characterId, which would fail the whole migration.
ALTER TABLE "Combatant"
  ADD CONSTRAINT "Combatant_player_has_character_id"
  CHECK (NOT "isPlayer" OR "characterId" IS NOT NULL);

-- Exactly one isPlayer:true Combatant per encounter, enforced at the
-- database instead of trusted by convention. resolveEncounterTurnAuthority
-- only checked this at action time, not at creation time — nothing
-- previously stopped a second one from being created. Same
-- pre-check-then-constrain shape as
-- 20260912220000_enforce_single_active_encounter's
-- Encounter_one_active_per_campaign_key: fail closed if data already
-- violates the invariant, don't silently repair or corrupt it.
DO $combatant_one_player_per_encounter$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Combatant" WHERE "isPlayer" = true
    GROUP BY "encounterId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce single-player-per-encounter invariant: duplicate isPlayer rows already exist';
  END IF;
END
$combatant_one_player_per_encounter$;

CREATE UNIQUE INDEX "Combatant_one_player_per_encounter_key"
ON "Combatant" ("encounterId")
WHERE "isPlayer" = true;

-- Schema's @@unique([encounterId, characterId]): the pair the three player
-- write paths scope by is unique by declaration, not only because today just
-- the player row carries a characterId. NULLs are distinct in a Postgres
-- unique index, so enemy rows (characterId NULL) are not constrained by it.
-- Placed after the single-player guard on purpose: the backfill copies one
-- characterId into every player row of an encounter, so pre-existing
-- duplicate player rows would also collide here — the guard reports that
-- case first, with its own message. Once the guard passes, at most one row
-- per encounter has a characterId, so this index cannot fail.
CREATE UNIQUE INDEX "Combatant_encounterId_characterId_key"
  ON "Combatant"("encounterId", "characterId");
