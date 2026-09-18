import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(ROOT, "prisma", "migrations", "20260918120000_add_campaign_scene_participants", "migration.sql"),
  "utf8",
);

describe("DC-NARR-002B PR 1 — Scene presence schema contract", () => {
  describe("Campaign.scenePresenceVersion", () => {
    it("declares scenePresenceVersion Int with default 0 in schema", () => {
      expect(SCHEMA).toMatch(/\bscenePresenceVersion\s+Int\s+@default\(0\)/);
    });

    it("adds scenePresenceVersion INTEGER NOT NULL DEFAULT 0 in migration", () => {
      expect(MIGRATION).toMatch(
        /ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "scenePresenceVersion" INTEGER NOT NULL DEFAULT 0;/i,
      );
    });

    it("Campaign model has sceneParticipants relation", () => {
      const campaignBlock = SCHEMA.match(/model Campaign \{([\s\S]*?)^\}/m)?.[1] ?? "";
      expect(campaignBlock).toMatch(/\bsceneParticipants\s+CampaignSceneParticipant\[\]/);
    });
  });

  describe("NPC composite tenant constraint and sceneParticipants relation", () => {
    it("NPC model has sceneParticipants relation", () => {
      const npcBlock = SCHEMA.match(/model NPC \{([\s\S]*?)^\}/m)?.[1] ?? "";
      expect(npcBlock).toMatch(/\bsceneParticipants\s+CampaignSceneParticipant\[\]/);
    });

    it("NPC model declares @@unique([id, campaignId], map: \"NPC_id_campaignId_key\")", () => {
      const npcBlock = SCHEMA.match(/model NPC \{([\s\S]*?)^\}/m)?.[1] ?? "";
      expect(npcBlock).toMatch(/@@unique\(\[id,\s*campaignId\],\s*map:\s*"NPC_id_campaignId_key"\)/);
    });

    it("migration creates unique index NPC_id_campaignId_key", () => {
      expect(MIGRATION).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS "NPC_id_campaignId_key" ON "NPC"\("id",\s*"campaignId"\);/i,
      );
    });
  });

  describe("CampaignSceneParticipant model", () => {
    const participantBlock = SCHEMA.match(/model CampaignSceneParticipant \{([\s\S]*?)^\}/m)?.[1] ?? "";

    it("model exists in schema", () => {
      expect(participantBlock).not.toBe("");
    });

    it("declares campaignId and npcId fields", () => {
      expect(participantBlock).toMatch(/\bcampaignId\s+String\b/);
      expect(participantBlock).toMatch(/\bnpcId\s+String\b/);
    });

    it("enforces composite primary key @@id([campaignId, npcId])", () => {
      expect(participantBlock).toMatch(/@@id\(\[campaignId,\s*npcId\]\)/);
    });

    it("enforces campaign relation with onDelete: Cascade", () => {
      expect(participantBlock).toMatch(
        /campaign\s+Campaign\s+@relation\(\s*fields:\s*\[campaignId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\s*\)/,
      );
    });

    it("enforces composite tenant relation to NPC([id, campaignId]) with onDelete: Cascade", () => {
      expect(participantBlock).toMatch(
        /npc\s+NPC\s+@relation\(\s*fields:\s*\[npcId,\s*campaignId\],\s*references:\s*\[id,\s*campaignId\],\s*onDelete:\s*Cascade\s*\)/,
      );
    });

    it("contains no speculative fields", () => {
      const fieldNames = participantBlock
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@") && !l.startsWith("///"))
        .map((l) => l.split(/\s+/)[0]);

      // Permitted fields only: campaignId, npcId, campaign, npc
      expect(fieldNames.sort()).toEqual(["campaign", "campaignId", "npc", "npcId"].sort());

      // Explicitly reject speculative fields on the model
      for (const forbidden of [
        "id",
        "createdAt",
        "updatedAt",
        "role",
        "focus",
        "isCompanion",
        "diedAt",
        "notes",
        "status",
        "locationId",
        "nodeId",
      ]) {
        expect(fieldNames).not.toContain(forbidden);
      }
    });
  });

  describe("Migration structure and safety invariants", () => {
    it("is contained in a single tagged DO block", () => {
      const doMatches = [...MIGRATION.matchAll(/^DO \$(\w+)\$/gm)];
      expect(doMatches).toHaveLength(1);
      expect(doMatches[0][1]).toBe("add_campaign_scene_participants");
      expect(MIGRATION).toMatch(/END\s*\n\$add_campaign_scene_participants\$;/);
    });

    it("creates table CampaignSceneParticipant with composite primary key", () => {
      expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS "CampaignSceneParticipant"/);
      expect(MIGRATION).toMatch(/"campaignId"\s+TEXT NOT NULL/);
      expect(MIGRATION).toMatch(/"npcId"\s+TEXT NOT NULL/);
      expect(MIGRATION).toMatch(/CONSTRAINT "CampaignSceneParticipant_pkey" PRIMARY KEY \("campaignId",\s*"npcId"\)/);
    });

    it("creates both foreign keys with ON DELETE CASCADE", () => {
      expect(MIGRATION).toMatch(/FOREIGN KEY \("campaignId"\) REFERENCES "Campaign"\("id"\)\s+ON DELETE CASCADE/i);
      expect(MIGRATION).toMatch(
        /FOREIGN KEY \("npcId",\s*"campaignId"\) REFERENCES "NPC"\("id",\s*"campaignId"\)\s+ON DELETE CASCADE/i,
      );
    });

    it("enables row level security explicitly on CampaignSceneParticipant", () => {
      expect(MIGRATION).toMatch(/ALTER TABLE "public"\."CampaignSceneParticipant" ENABLE ROW LEVEL SECURITY;/);
    });

    it("contains no data mutations or backfills", () => {
      const executableLines = MIGRATION
        .split(/\r?\n/)
        .filter((l) => !/^\s*--/.test(l))
        .join("\n");
      expect(executableLines).not.toMatch(/\bINSERT\s+INTO\b/i);
      expect(executableLines).not.toMatch(/\bUPDATE\s+"?\w+"?\s+SET\b/i);
      expect(executableLines).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(executableLines).not.toMatch(/\bTRUNCATE\b/i);
    });
  });
});
