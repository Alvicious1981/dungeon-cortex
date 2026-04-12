-- Performance indexes on FK columns.
-- PostgreSQL does not auto-index foreign key columns.
-- IF NOT EXISTS guards make this safe to apply on any environment state.

CREATE INDEX IF NOT EXISTS "GameLog_campaignId_idx"       ON "GameLog"("campaignId");
CREATE INDEX IF NOT EXISTS "Encounter_campaignId_idx"     ON "Encounter"("campaignId");
CREATE INDEX IF NOT EXISTS "Combatant_encounterId_idx"    ON "Combatant"("encounterId");
CREATE INDEX IF NOT EXISTS "InventoryItem_characterId_idx" ON "InventoryItem"("characterId");
CREATE INDEX IF NOT EXISTS "Character_userId_idx"         ON "Character"("userId");
CREATE INDEX IF NOT EXISTS "Campaign_userId_idx"          ON "Campaign"("userId");
CREATE INDEX IF NOT EXISTS "Campaign_characterId_idx"     ON "Campaign"("characterId");
CREATE INDEX IF NOT EXISTS "Quest_campaignId_idx"         ON "Quest"("campaignId");
