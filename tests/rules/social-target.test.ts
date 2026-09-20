/**
 * tests/rules/social-target.test.ts
 *
 * Unit tests for resolveSocialSceneTarget.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSocialSceneTarget, type SocialTargetDb } from "@/lib/rules/social-target";

describe("resolveSocialSceneTarget", () => {
  let mockDb: SocialTargetDb;

  beforeEach(() => {
    mockDb = {
      campaignSceneParticipant: {
        findMany: vi.fn(),
      },
      nPC: {
        findUnique: vi.fn(),
      },
    };
  });

  describe("Canonical mode (scenePresenceVersion >= 1)", () => {
    it("returns NO_TARGET_AVAILABLE when scene has no participants and no target is named", async () => {
      (mockDb.campaignSceneParticipant!.findMany as any).mockResolvedValue([]);

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        scenePresenceVersion: 1,
        db: mockDb,
      });

      expect(result).toEqual({
        ok: false,
        error: "No target available in the current scene.",
        code: "NO_TARGET_AVAILABLE",
        status: 400,
      });
    });

    it("returns NPC_NOT_PRESENT when explicit target is named but scene has 0 participants", async () => {
      (mockDb.campaignSceneParticipant!.findMany as any).mockResolvedValue([]);

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        targetName: "innkeeper",
        scenePresenceVersion: 1,
        currentNodeNpcSeed: "innkeeper_legacy", // must NOT fall back
        db: mockDb,
      });

      expect(result).toEqual({
        ok: false,
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
        status: 400,
      });
      // Legacy table must not be queried in canonical mode
      expect(mockDb.nPC.findUnique).not.toHaveBeenCalled();
    });

    it("resolves exact name match for single candidate", async () => {
      (mockDb.campaignSceneParticipant!.findMany as any).mockResolvedValue([
        {
          campaignId: "camp_1",
          npcId: "npc_1",
          npc: { id: "npc_1", campaignId: "camp_1", name: "Barnaby", seed: "innkeeper_1" },
        },
      ]);

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        targetName: "Barnaby",
        scenePresenceVersion: 1,
        db: mockDb,
      });

      expect(result).toEqual({
        ok: true,
        target: { id: "npc_1", campaignId: "camp_1", name: "Barnaby", seed: "innkeeper_1" },
      });
    });

    it("resolves unique partial match when exact match does not hit", async () => {
      (mockDb.campaignSceneParticipant!.findMany as any).mockResolvedValue([
        {
          campaignId: "camp_1",
          npcId: "npc_1",
          npc: { id: "npc_1", campaignId: "camp_1", name: "Barnaby the Innkeeper", seed: "innkeeper_1" },
        },
      ]);

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        targetName: "innkeeper",
        scenePresenceVersion: 1,
        db: mockDb,
      });

      expect(result).toEqual({
        ok: true,
        target: { id: "npc_1", campaignId: "camp_1", name: "Barnaby the Innkeeper", seed: "innkeeper_1" },
      });
    });

    it("fails with MECHANICAL_CLARIFICATION_REQUIRED when partial match matches multiple candidates", async () => {
      (mockDb.campaignSceneParticipant!.findMany as any).mockResolvedValue([
        {
          campaignId: "camp_1",
          npcId: "npc_1",
          npc: { id: "npc_1", campaignId: "camp_1", name: "Guard Bob", seed: "guard_bob" },
        },
        {
          campaignId: "camp_1",
          npcId: "npc_2",
          npc: { id: "npc_2", campaignId: "camp_1", name: "Guard Alice", seed: "guard_alice" },
        },
      ]);

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        targetName: "guard",
        scenePresenceVersion: 1,
        db: mockDb,
      });

      expect(result).toEqual({
        ok: false,
        error: "Multiple matching targets found. Specify which one.",
        code: "MECHANICAL_CLARIFICATION_REQUIRED",
        status: 400,
      });
    });

    it("resolves unique participant when pronoun target ('him') is used with 1 NPC", async () => {
      (mockDb.campaignSceneParticipant!.findMany as any).mockResolvedValue([
        {
          campaignId: "camp_1",
          npcId: "npc_1",
          npc: { id: "npc_1", campaignId: "camp_1", name: "Barnaby", seed: "innkeeper_1" },
        },
      ]);

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        targetName: "him",
        scenePresenceVersion: 1,
        db: mockDb,
      });

      expect(result).toEqual({
        ok: true,
        target: { id: "npc_1", campaignId: "camp_1", name: "Barnaby", seed: "innkeeper_1" },
      });
    });

    it("fails with MECHANICAL_CLARIFICATION_REQUIRED when pronoun target ('them') is used with 2+ NPCs", async () => {
      (mockDb.campaignSceneParticipant!.findMany as any).mockResolvedValue([
        {
          campaignId: "camp_1",
          npcId: "npc_1",
          npc: { id: "npc_1", campaignId: "camp_1", name: "Barnaby", seed: "innkeeper_1" },
        },
        {
          campaignId: "camp_1",
          npcId: "npc_2",
          npc: { id: "npc_2", campaignId: "camp_1", name: "Guard", seed: "guard_1" },
        },
      ]);

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        targetName: "them",
        scenePresenceVersion: 1,
        db: mockDb,
      });

      expect(result).toEqual({
        ok: false,
        error: "Multiple characters are present. State who you are talking to.",
        code: "MECHANICAL_CLARIFICATION_REQUIRED",
        status: 400,
      });
    });

    it("filters out cross-campaign NPCs safely", async () => {
      (mockDb.campaignSceneParticipant!.findMany as any).mockResolvedValue([
        {
          campaignId: "camp_1",
          npcId: "npc_wrong",
          npc: { id: "npc_wrong", campaignId: "camp_other", name: "Barnaby", seed: "innkeeper_1" },
        },
      ]);

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        targetName: "Barnaby",
        scenePresenceVersion: 1,
        db: mockDb,
      });

      expect(result).toEqual({
        ok: false,
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
        status: 400,
      });
    });
  });

  describe("Legacy mode (scenePresenceVersion === 0)", () => {
    it("resolves from currentNodeNpcSeed when available", async () => {
      (mockDb.nPC.findUnique as any).mockResolvedValue({
        id: "npc_legacy",
        campaignId: "camp_1",
        name: "Barnaby the Innkeeper",
        seed: "innkeeper_1",
      });

      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        targetName: "innkeeper",
        scenePresenceVersion: 0,
        currentNodeNpcSeed: "innkeeper_1",
        db: mockDb,
      });

      expect(result).toEqual({
        ok: true,
        target: {
          id: "npc_legacy",
          campaignId: "camp_1",
          name: "Barnaby the Innkeeper",
          seed: "innkeeper_1",
        },
      });
    });

    it("returns NO_TARGET_AVAILABLE when currentNodeNpcSeed is missing and no target specified", async () => {
      const result = await resolveSocialSceneTarget({
        campaignId: "camp_1",
        scenePresenceVersion: 0,
        currentNodeNpcSeed: null,
        db: mockDb,
      });

      expect(result).toEqual({
        ok: false,
        error: "No target available in the current scene.",
        code: "NO_TARGET_AVAILABLE",
        status: 400,
      });
    });
  });
});
