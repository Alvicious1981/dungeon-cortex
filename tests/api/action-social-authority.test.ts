/**
 * tests/api/action-social-authority.test.ts
 *
 * Route typed social actions outside combat through the authoritative social engine.
 * Covers NARR-FIND-02 / PR 2 requirements.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as ACTION_POST } from "@/app/api/campaign/[id]/action/route";
import { POST as SOCIAL_POST } from "@/app/api/campaign/[id]/social/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { buildCampaignContext } from "@/lib/memory/context";
import { resolveSocialCheck, SocialServiceError } from "@/lib/rules/social-service";
import { streamNarrative } from "@/lib/ai/narrator";
import { resolveAbilityCheck } from "@/lib/rules/ability-check";
import { finalizeEncounterTurn } from "@/lib/rules/combat-pipeline";
import { parseIntent } from "@/lib/ai/intent";

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    after: vi.fn((fn) => fn()),
  };
});

const prismaTx = vi.hoisted(() => ({
  gameLog: {
    create: vi.fn(async (args: unknown) => ({ id: "log_tx", ...(args as object) })),
  },
  nPC: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  character: {
    findUnique: vi.fn(),
  },
  campaign: {
    findUnique: vi.fn(),
  },
  combatant: {
    findMany: vi.fn(async () => []),
    update: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  encounter: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    character: { findUnique: vi.fn() },
    nPC: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    campaignSceneParticipant: { findMany: vi.fn(), findUnique: vi.fn() },
    gameLog: {
      create: vi.fn(async (args: unknown) => ({ id: "log_main", ...(args as object) })),
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => []),
    },
    encounter: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    combatant: { findMany: vi.fn(async () => []), update: vi.fn() },
    inventoryItem: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    actionRequestReceipt: {
      create: vi.fn(async (args: any) => ({
        id: "receipt_1",
        status: "PROCESSING",
        ...args.data,
      })),
      findUnique: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (fn: (tx: typeof prismaTx) => Promise<unknown>) => fn(prismaTx)),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {
    constructor(msg: string) { super(msg); this.name = "AuthError"; }
  },
}));

vi.mock("@/lib/memory/context", () => ({
  buildCampaignContext: vi.fn(),
}));

vi.mock("@/lib/rules/social-service", () => ({
  resolveSocialCheck: vi.fn(),
  SocialServiceError: class extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = "SocialServiceError";
    }
  },
}));

vi.mock("@/lib/rules/ability-check", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    resolveAbilityCheck: vi.fn((input: any, actor: any) => actual.resolveAbilityCheck(input, actor)),
  };
});

vi.mock("@/lib/rules/combat-pipeline", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    finalizeEncounterTurn: vi.fn(),
  };
});

vi.mock("@/lib/ai/narrator", () => ({
  streamNarrative: vi.fn(() => ({
    textStream: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    textPromise: Promise.resolve("Narrative response."),
    levelUpPayload: null,
    merchantPayload: null,
  })),
}));

function actionRequest(body: unknown) {
  return new Request("http://localhost:3000/api/campaign/camp_1/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function socialRequest(body: unknown) {
  return new Request("http://localhost:3000/api/campaign/camp_1/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const params = Promise.resolve({ id: "camp_1" });

describe("NARR-FIND-02: Typed social actions outside combat", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (getAuthUser as any).mockResolvedValue({ id: "user_1" });

    (prisma.campaign.findUnique as any).mockResolvedValue({
      id: "camp_1",
      userId: "user_1",
      status: "active",
      scenePresenceVersion: 1,
      currentLocationId: "loc_1",
      currentNodeId: "node_1",
    });

    (buildCampaignContext as any).mockResolvedValue({
      character: {
        id: "char_1",
        class: "bard",
        level: 3,
        stats: { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 12, CHA: 16 },
        skillProficiencies: ["Persuasion", "Deception", "Intimidation"],
        exhaustionLevel: 0,
        inventory: [],
      },
      gold: 50,
      activeNPCs: [],
      activeNPC: null,
      activeEncounter: null,
      recentLogs: [],
      quests: [],
      relevantMemories: [],
      currentExploration: {
        currentLocation: { id: "loc_1", name: "Village" },
        currentNode: { id: "node_1", name: "Tavern", npcSeed: "innkeeper_1" },
      },
    });

    (prisma.campaignSceneParticipant.findMany as any).mockResolvedValue([
      {
        campaignId: "camp_1",
        npcId: "npc_innkeeper",
        npc: {
          id: "npc_innkeeper",
          campaignId: "camp_1",
          name: "Barnaby the Innkeeper",
          seed: "innkeeper_1",
        },
      },
    ]);

    (resolveSocialCheck as any).mockResolvedValue({
      ok: true,
      campaignId: "camp_1",
      characterId: "char_1",
      npcId: "npc_innkeeper",
      npcSeed: "innkeeper_1",
      approach: "persuade",
      skill: "Persuasion",
      roll: 14,
      abilityModifier: 3,
      proficiencyApplied: 2,
      total: 19,
      dc: 15,
      success: true,
      attitudeBefore: "Indifferent",
      attitudeAfter: "Friendly",
      dispositionBefore: 0,
      dispositionAfter: 3,
    });
  });

  it("routes 'I persuade the innkeeper' through resolveSocialCheck with atomic logs and narration", async () => {
    const res = await ACTION_POST(actionRequest({ action: "I persuade the innkeeper" }), { params });
    expect(res.status).toBe(200);

    // 1. Authoritative social check called exactly once with transaction
    expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
    expect(resolveSocialCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp_1",
        npcId: "npc_innkeeper",
        approach: "persuade",
        tx: prismaTx,
      })
    );

    // 2. Generic ability check resolver NOT called for social check
    expect(resolveAbilityCheck).not.toHaveBeenCalled();

    // 3. User log and system social log are atomic inside transaction
    expect(prismaTx.gameLog.create).toHaveBeenCalledTimes(2);
    // User log:
    expect(prismaTx.gameLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: "camp_1",
          role: "user",
          content: "I persuade the innkeeper",
        }),
      })
    );
    // Deterministic social log:
    expect(prismaTx.gameLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: "camp_1",
          role: "system",
          content: expect.stringContaining("🎲 Social check: Persuasion (persuade) targeting Barnaby the Innkeeper"),
        }),
      })
    );

    // 4. Narration started
    expect(streamNarrative).toHaveBeenCalledTimes(1);
  });

  it("handles compound social sentence 'I persuade the innkeeper to open the gate'", async () => {
    const res = await ACTION_POST(
      actionRequest({ action: "I persuade the innkeeper to open the gate" }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
    expect(resolveSocialCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: "npc_innkeeper",
        approach: "persuade",
      })
    );
  });

  it("handles prepositional social phrase 'I plead with the innkeeper to give us shelter'", async () => {
    const res = await ACTION_POST(
      actionRequest({ action: "I plead with the innkeeper to give us shelter" }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
    expect(resolveSocialCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: "npc_innkeeper",
        approach: "persuade",
      })
    );
  });

  it("refuses with NPC_NOT_PRESENT when explicit target does not match any scene participant", async () => {
    const res = await ACTION_POST(actionRequest({ action: "I persuade the wizard" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "NPC_NOT_PRESENT",
    });

    expect(resolveSocialCheck).not.toHaveBeenCalled();
    expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("refuses with MECHANICAL_CLARIFICATION_REQUIRED when multiple participants match explicit target", async () => {
    (prisma.campaignSceneParticipant.findMany as any).mockResolvedValue([
      {
        campaignId: "camp_1",
        npcId: "guard_1",
        npc: { id: "guard_1", campaignId: "camp_1", name: "Town Guard Alice", seed: "guard_1" },
      },
      {
        campaignId: "camp_1",
        npcId: "guard_2",
        npc: { id: "guard_2", campaignId: "camp_1", name: "Town Guard Bob", seed: "guard_2" },
      },
    ]);

    const res = await ACTION_POST(actionRequest({ action: "I deceive the guard" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "MECHANICAL_CLARIFICATION_REQUIRED",
    });

    expect(resolveSocialCheck).not.toHaveBeenCalled();
    expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
  });

  it("resolves unique participant when no explicit target is specified and exactly 1 NPC is present", async () => {
    const res = await ACTION_POST(actionRequest({ action: "I persuade" }), { params });
    expect(res.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: "npc_innkeeper",
        approach: "persuade",
      })
    );
  });

  it("resolves unique participant for pronoun targets ('I persuade him') when exactly 1 NPC is present", async () => {
    const res = await ACTION_POST(actionRequest({ action: "I persuade him" }), { params });
    expect(res.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: "npc_innkeeper",
        approach: "persuade",
      })
    );
  });

  it("refuses with MECHANICAL_CLARIFICATION_REQUIRED for pronoun/collective targets when 2+ NPCs are present", async () => {
    (prisma.campaignSceneParticipant.findMany as any).mockResolvedValue([
      {
        campaignId: "camp_1",
        npcId: "guard_1",
        npc: { id: "guard_1", campaignId: "camp_1", name: "Town Guard Alice", seed: "guard_1" },
      },
      {
        campaignId: "camp_1",
        npcId: "guard_2",
        npc: { id: "guard_2", campaignId: "camp_1", name: "Town Guard Bob", seed: "guard_2" },
      },
    ]);

    for (const phrase of ["I persuade", "I persuade him", "I deceive them", "I intimidate everyone"]) {
      const res = await ACTION_POST(actionRequest({ action: phrase }), { params });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({
        code: "MECHANICAL_CLARIFICATION_REQUIRED",
      });
    }

    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("refuses with NO_TARGET_AVAILABLE when no explicit target and 0 NPCs are present", async () => {
    (prisma.campaignSceneParticipant.findMany as any).mockResolvedValue([]);

    const res = await ACTION_POST(actionRequest({ action: "I persuade" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "NO_TARGET_AVAILABLE",
    });

    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("canonical mode (scenePresenceVersion >= 1) ignores legacy currentNode.npcSeed when participants are empty", async () => {
    (prisma.campaignSceneParticipant.findMany as any).mockResolvedValue([]);

    const res = await ACTION_POST(actionRequest({ action: "I persuade the innkeeper" }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "NPC_NOT_PRESENT",
    });
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("legacy mode (scenePresenceVersion === 0) resolves from currentNode.npcSeed", async () => {
    (prisma.campaign.findUnique as any).mockResolvedValue({
      id: "camp_1",
      userId: "user_1",
      status: "active",
      scenePresenceVersion: 0,
      currentLocationId: "loc_1",
      currentNodeId: "node_1",
    });

    (prisma.nPC.findUnique as any).mockResolvedValue({
      id: "npc_legacy",
      campaignId: "camp_1",
      name: "Barnaby the Innkeeper",
      seed: "innkeeper_1",
    });

    const res = await ACTION_POST(actionRequest({ action: "I persuade the innkeeper" }), { params });
    expect(res.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: "npc_legacy",
        approach: "persuade",
      })
    );
  });

  describe("Combat social containment (NARR-FIND-02)", () => {
    const combatContext = {
      character: {
        id: "char_1",
        class: "bard",
        level: 3,
        stats: { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 12, CHA: 16 },
        skillProficiencies: ["Persuasion", "Deception", "Intimidation"],
        exhaustionLevel: 0,
        inventory: [],
      },
      gold: 50,
      activeNPCs: [],
      activeNPC: null,
      activeEncounter: {
        id: "enc_1",
        combatants: [
          { id: "c_player", isPlayer: true, hp: 20, conditions: [] },
          { id: "c_goblin", name: "Goblin", isPlayer: false, hp: 7, conditions: [], stats: { WIS: 10 } },
        ],
        currentTurnIndex: 0,
        round: 1,
      },
      recentLogs: [],
      quests: [],
      relevantMemories: [],
      currentExploration: null,
    };

    async function assertCombatSocialRefusal(
      actionText: string,
      expectedApproach?: "persuade" | "deceive" | "intimidate"
    ) {
      const intent = await parseIntent(actionText);
      expect(intent.actionType).toBe("ability_check");
      if (expectedApproach) {
        expect(intent.socialApproach).toBe(expectedApproach);
      } else {
        expect(intent.socialApproach).toBeDefined();
      }

      (buildCampaignContext as any).mockResolvedValue(combatContext);

      const res = await ACTION_POST(actionRequest({ action: actionText }), { params });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({
        error: "Social interactions during combat are not supported.",
        code: "COMBAT_SOCIAL_UNSUPPORTED",
      });

      // Invariants:
      // resolveSocialCheck NOT called
      expect(resolveSocialCheck).not.toHaveBeenCalled();
      // resolveAbilityCheck NOT called
      expect(resolveAbilityCheck).not.toHaveBeenCalled();
      // finalizeEncounterTurn NOT called
      expect(finalizeEncounterTurn).not.toHaveBeenCalled();
      // no GameLog mutation
      expect(prisma.gameLog.create).not.toHaveBeenCalled();
      expect(prismaTx.gameLog.create).not.toHaveBeenCalled();
      // streamNarrative NOT called
      expect(streamNarrative).not.toHaveBeenCalled();
    }

    it("fails closed with COMBAT_SOCIAL_UNSUPPORTED for Persuasion ('I persuade the goblin')", async () => {
      await assertCombatSocialRefusal("I persuade the goblin", "persuade");
    });

    it("fails closed with COMBAT_SOCIAL_UNSUPPORTED for Deception ('I deceive the goblin')", async () => {
      await assertCombatSocialRefusal("I deceive the goblin", "deceive");
    });

    it("fails closed with COMBAT_SOCIAL_UNSUPPORTED for opposed Deception vocabulary ('I lie to the goblin')", async () => {
      await assertCombatSocialRefusal("I lie to the goblin", "deceive");
    });

    it("fails closed with COMBAT_SOCIAL_UNSUPPORTED for Intimidation ('I intimidate the goblin')", async () => {
      await assertCombatSocialRefusal("I intimidate the goblin", "intimidate");
    });
  });

  it("keeps non-social Deception ('I disguise myself') on the generic ability-check route", async () => {
    const intent = await parseIntent("I disguise myself");
    expect(intent.actionType).toBe("ability_check");
    expect(intent.skill).toBe("Deception");
    expect((intent as any).socialApproach).toBeUndefined();

    const res = await ACTION_POST(actionRequest({ action: "I disguise myself" }), { params });
    expect(res.status).toBe(200);

    // resolveSocialCheck MUST NOT be called for disguise
    expect(resolveSocialCheck).not.toHaveBeenCalled();
    // Generic resolveAbilityCheck MUST be called
    expect(resolveAbilityCheck).toHaveBeenCalledTimes(1);
    expect(resolveAbilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        skill: "Deception",
        band: "hard",
      }),
      expect.anything()
    );
  });

  describe("Cross-surface parity: /action and /social derive identical mechanics", () => {
    it("matches DC, rolls, outcome, and disposition transitions between chat and modal", async () => {
      // Mock resolveSocialCheck to return deterministic payload
      const mockResult = {
        ok: true,
        campaignId: "camp_1",
        characterId: "char_1",
        npcId: "npc_innkeeper",
        npcSeed: "innkeeper_1",
        approach: "persuade" as const,
        skill: "Persuasion" as const,
        roll: 15,
        abilityModifier: 3,
        proficiencyApplied: 2,
        total: 20,
        dc: 15,
        success: true,
        attitudeBefore: "Indifferent" as const,
        attitudeAfter: "Friendly" as const,
        dispositionBefore: 0,
        dispositionAfter: 3,
      };
      (resolveSocialCheck as any).mockResolvedValue(mockResult);

      (prisma.nPC.findUnique as any).mockResolvedValue({
        id: "npc_innkeeper",
        campaignId: "camp_1",
        name: "Barnaby the Innkeeper",
        seed: "innkeeper_1",
        role: "commoner",
        hasMetPlayer: true,
      });
      (prisma.campaignSceneParticipant.findUnique as any).mockResolvedValue({
        npcId: "npc_innkeeper",
      });

      // 1. Call via /social modal route
      const socialRes = await SOCIAL_POST(
        socialRequest({
          npcId: "npc_innkeeper",
          approach: "persuade",
          intent: "I persuade the innkeeper",
        }),
        { params }
      );
      expect(socialRes.status).toBe(200);
      const socialJson = await socialRes.json();

      // 2. Call via /action natural chat route
      const actionRes = await ACTION_POST(
        actionRequest({
          action: "I persuade the innkeeper",
        }),
        { params }
      );
      expect(actionRes.status).toBe(200);

      // Verify both surfaces invoked resolveSocialCheck with the exact same core mechanics
      expect(resolveSocialCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: "camp_1",
          npcId: "npc_innkeeper",
          approach: "persuade",
        })
      );

      // Verify /social response contains the exact mechanics produced by resolveSocialCheck
      expect(socialJson).toMatchObject({
        skill: "Persuasion",
        approach: "persuade",
        dc: 15,
        roll: 15,
        total: 20,
        success: true,
        attitudeBefore: "Indifferent",
        attitudeAfter: "Friendly",
        dispositionBefore: 0,
        dispositionAfter: 3,
      });

      // Both created system GameLogs with the same formatSocialCheckLog formatter
      const logs = (prismaTx.gameLog.create as any).mock.calls.map((c: any) => c[0].data.content);
      const systemLogs = logs.filter((c: string) => c.includes("🎲 Social check:"));
      expect(systemLogs.length).toBe(2);
      expect(systemLogs[0]).toContain("🎲 Social check: Persuasion (persuade) targeting Barnaby the Innkeeper");
      expect(systemLogs[1]).toContain("🎲 Social check: Persuasion (persuade) targeting Barnaby the Innkeeper");
    });
  });
});
