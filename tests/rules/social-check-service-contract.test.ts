import { beforeEach, describe, expect, it, vi } from "vitest";

type CampaignFixture = {
  id: string;
};

type CharacterFixture = {
  id: string;
  campaignId: string;
  stats: Record<string, number>;
};

type NpcFixture = {
  id: string;
  campaignId: string;
  seed: string;
  name: string;
  disposition: number | null;
  hasMetPlayer: boolean;
};

type SocialCheckTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  nPC: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  trade?: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  quest?: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

type SocialApproach = "persuade" | "intimidate" | "deceive";

type ResolveSocialCheckInput = {
  campaignId: string;
  characterId: string;
  npcId: string;
  approach: SocialApproach | string;
  dispositionDelta: number;
  intent?: string;
  roll?: number;
  dc?: number;
  tx: SocialCheckTx;
};

type SocialCheckServiceResult = {
  ok?: boolean;
  campaignId?: string;
  characterId?: string;
  npcId?: string;
  approach?: SocialApproach;
  roll?: number;
  dc?: number;
  success?: boolean;
  dispositionBefore?: number;
  dispositionAfter?: number;
  facts?: unknown;
  narrative?: unknown;
  text?: unknown;
  prose?: unknown;
  message?: unknown;
};

type ResolveSocialCheck = (
  input: ResolveSocialCheckInput
) => Promise<SocialCheckServiceResult>;

const baseCampaigns: CampaignFixture[] = [
  { id: "campaign-1" },
  { id: "campaign-2" },
];

const baseCharacters: CharacterFixture[] = [
  { id: "character-1", campaignId: "campaign-1", stats: { CHA: 14 } },
  { id: "character-2", campaignId: "campaign-2", stats: { CHA: 8 } },
];

const baseNpcs: NpcFixture[] = [
  {
    id: "npc-1",
    campaignId: "campaign-1",
    seed: "gate_guard",
    name: "Tovin",
    disposition: 0,
    hasMetPlayer: true,
  },
  {
    id: "npc-2",
    campaignId: "campaign-1",
    seed: "harbor_scribe",
    name: "Elian Reed",
    disposition: 2,
    hasMetPlayer: true,
  },
  {
    id: "npc-3",
    campaignId: "campaign-2",
    seed: "other_guard",
    name: "Other Tovin",
    disposition: -1,
    hasMetPlayer: true,
  },
];

async function loadSocialService(): Promise<{
  resolveSocialCheck: ResolveSocialCheck;
}> {
  const modulePath = "../../lib/rules/social-service";
  const mod = await import(modulePath);
  return {
    resolveSocialCheck: mod.resolveSocialCheck as ResolveSocialCheck,
  };
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  characters?: CharacterFixture[];
  npcs?: NpcFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const characters = (options?.characters ?? baseCharacters).map((character) => ({
    ...character,
    stats: { ...character.stats },
  }));
  const npcs = (options?.npcs ?? baseNpcs).map((npc) => ({ ...npc }));

  const tx: SocialCheckTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaigns.find((campaign) => campaign.id === where.id) ?? null
      ),
    },
    character: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        characters.find((character) => character.id === where.id) ?? null
      ),
    },
    nPC: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        findNpcByWhere(npcs, where)
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<NpcFixture>;
        }) => {
          const npc = findNpcByWhere(npcs, where);
          if (!npc) throw new Error("Missing NPC");
          Object.assign(npc, data);
          return { ...npc };
        }
      ),
    },
    trade: {
      create: vi.fn(),
      update: vi.fn(),
    },
    quest: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  return { campaigns, characters, npcs, tx };
}

function findNpcByWhere(
  npcs: NpcFixture[],
  where: Record<string, unknown>
): NpcFixture | null {
  if ("id" in where && typeof where.id === "string") {
    return npcs.find((npc) => npc.id === where.id) ?? null;
  }

  const compound = where.campaignId_seed;
  if (
    typeof compound === "object" &&
    compound !== null &&
    "campaignId" in compound &&
    "seed" in compound
  ) {
    return (
      npcs.find(
        (npc) =>
          npc.campaignId === compound.campaignId &&
          npc.seed === compound.seed
      ) ?? null
    );
  }

  return null;
}

function input(
  tx: SocialCheckTx,
  overrides?: Partial<ResolveSocialCheckInput>
): ResolveSocialCheckInput {
  return {
    campaignId: "campaign-1",
    characterId: "character-1",
    npcId: "npc-1",
    approach: "persuade",
    dispositionDelta: 2,
    intent: "Ask the guard to allow entry.",
    roll: 15,
    tx,
    ...overrides,
  };
}

function findNpc(npcs: NpcFixture[], id: string): NpcFixture {
  const npc = npcs.find((candidate) => candidate.id === id);
  if (!npc) throw new Error(`Missing NPC ${id}`);
  return npc;
}

function expectStructuredFacts(result: SocialCheckServiceResult) {
  expect(result).toMatchObject({ ok: true });
  expect(result.facts ?? result).toEqual(expect.any(Object));
}

function expectNoNarrativeText(result: SocialCheckServiceResult) {
  expect(result.narrative).toBeUndefined();
  expect(result.text).toBeUndefined();
  expect(result.prose).toBeUndefined();
  expect(result.message).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(
    /\b(narration|narrative|prose|flavorText|boxed text)\b/i
  );
}

function expectNoForbiddenRetroTerms(result: unknown) {
  expect(JSON.stringify(result)).not.toMatch(
    /AD&D|OSR|THAC0|descending AC|AC descendente|saving throw vs|save vs death|gold for XP|XP por oro/i
  );
}

describe("social-service resolveSocialCheck contract", () => {
  let resolveSocialCheck: ResolveSocialCheck;

  beforeEach(async () => {
    ({ resolveSocialCheck } = await loadSocialService());
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaigns: [] });

    await expect(resolveSocialCheck(input(tx))).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("rejects a missing character", async () => {
    const { tx } = createTx({ characters: [] });

    await expect(resolveSocialCheck(input(tx))).rejects.toMatchObject({
      code: "CHARACTER_NOT_FOUND",
    });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("rejects a missing NPC", async () => {
    const { tx } = createTx({ npcs: [] });

    await expect(resolveSocialCheck(input(tx))).rejects.toMatchObject({
      code: "NPC_NOT_FOUND",
    });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("rejects an NPC from another campaign", async () => {
    const { tx } = createTx();

    await expect(
      resolveSocialCheck(input(tx, { npcId: "npc-3" }))
    ).rejects.toMatchObject({ code: "NPC_OWNERSHIP_MISMATCH" });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("rejects a character from another campaign", async () => {
    const { tx } = createTx();

    await expect(
      resolveSocialCheck(input(tx, { characterId: "character-2" }))
    ).rejects.toMatchObject({ code: "CHARACTER_OWNERSHIP_MISMATCH" });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid skill or approach", async () => {
    const { tx } = createTx();

    await expect(
      resolveSocialCheck(input(tx, { approach: "morale" }))
    ).rejects.toMatchObject({ code: "INVALID_SOCIAL_APPROACH" });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid dispositionDelta", async () => {
    const { tx } = createTx();

    await expect(
      resolveSocialCheck(input(tx, { dispositionDelta: 99 }))
    ).rejects.toMatchObject({ code: "INVALID_DISPOSITION_DELTA" });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("does not allow disposition below the minimum", async () => {
    const { npcs, tx } = createTx({
      npcs: [
        {
          id: "npc-1",
          campaignId: "campaign-1",
          seed: "gate_guard",
          name: "Tovin",
          disposition: -10,
          hasMetPlayer: true,
        },
      ],
    });

    const result = await resolveSocialCheck(
      input(tx, { approach: "intimidate", dispositionDelta: 4, roll: 1 })
    );

    expect(findNpc(npcs, "npc-1").disposition).toBe(-10);
    expect(result.dispositionAfter).toBe(-10);
  });

  it("does not allow disposition above the maximum", async () => {
    const { npcs, tx } = createTx({
      npcs: [
        {
          id: "npc-1",
          campaignId: "campaign-1",
          seed: "gate_guard",
          name: "Tovin",
          disposition: 10,
          hasMetPlayer: true,
        },
      ],
    });

    const result = await resolveSocialCheck(input(tx, { dispositionDelta: 4, roll: 20 }));

    expect(findNpc(npcs, "npc-1").disposition).toBe(10);
    expect(result.dispositionAfter).toBe(10);
  });

  it("improves disposition deterministically on valid success", async () => {
    const { npcs, tx } = createTx();

    const result = await resolveSocialCheck(input(tx, { roll: 15 }));

    expect(result).toMatchObject({
      ok: true,
      success: true,
      dispositionBefore: 0,
      dispositionAfter: 2,
    });
    expect(findNpc(npcs, "npc-1").disposition).toBe(2);
  });

  it("conserves disposition on failed non-intimidation checks", async () => {
    const { npcs, tx } = createTx();

    const result = await resolveSocialCheck(
      input(tx, { approach: "deceive", dispositionDelta: 2, roll: 2 })
    );

    expect(result).toMatchObject({
      ok: true,
      success: false,
      dispositionBefore: 0,
      dispositionAfter: 0,
    });
    expect(findNpc(npcs, "npc-1").disposition).toBe(0);
  });

  it("worsens disposition on failed intimidation checks", async () => {
    const { npcs, tx } = createTx();

    const result = await resolveSocialCheck(
      input(tx, { approach: "intimidate", dispositionDelta: 2, roll: 2 })
    );

    expect(result).toMatchObject({
      ok: true,
      success: false,
      dispositionBefore: 0,
      dispositionAfter: -1,
    });
    expect(findNpc(npcs, "npc-1").disposition).toBe(-1);
  });

  it("does not touch other NPCs", async () => {
    const { npcs, tx } = createTx();

    await resolveSocialCheck(input(tx, { roll: 15 }));

    expect(findNpc(npcs, "npc-2")).toMatchObject({
      campaignId: "campaign-1",
      disposition: 2,
    });
  });

  it("does not touch other characters", async () => {
    const { characters, tx } = createTx();

    await resolveSocialCheck(input(tx, { roll: 15 }));

    expect(characters).toContainEqual({
      id: "character-2",
      campaignId: "campaign-2",
      stats: { CHA: 8 },
    });
    expect(tx.character.findUnique).toHaveBeenCalled();
  });

  it("does not touch another campaign", async () => {
    const { npcs, tx } = createTx();

    await resolveSocialCheck(input(tx, { roll: 15 }));

    expect(findNpc(npcs, "npc-3")).toMatchObject({
      campaignId: "campaign-2",
      disposition: -1,
    });
  });

  it("returns structured facts", async () => {
    const { tx } = createTx();

    const result = await resolveSocialCheck(input(tx, { roll: 15 }));

    expectStructuredFacts(result);
    expect(result.facts ?? result).toEqual(
      expect.objectContaining({
        campaignId: "campaign-1",
        characterId: "character-1",
        npcId: "npc-1",
        approach: "persuade",
        dispositionAfter: 2,
      })
    );
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();

    const result = await resolveSocialCheck(input(tx, { roll: 15 }));

    expectNoNarrativeText(result);
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await resolveSocialCheck(input(tx, { roll: 15 }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not introduce forbidden retro rules or jargon", async () => {
    const { tx } = createTx();

    const result = await resolveSocialCheck(input(tx, { roll: 15 }));

    expectNoForbiddenRetroTerms(result);
  });

  it("keeps D&D 5e/SRD 2014 skill checks as the social-check basis", async () => {
    const { tx } = createTx();

    const result = await resolveSocialCheck(input(tx, { roll: 15 }));

    expect(result).toMatchObject({
      roll: 15,
      dc: expect.any(Number),
      success: true,
    });
    expect(JSON.stringify(result.facts ?? result)).toMatch(/5e|SRD|d20/i);
  });

  it("does not modify commerce or quests", async () => {
    const { tx } = createTx();

    await resolveSocialCheck(input(tx, { roll: 15 }));

    expect(tx.trade?.create).not.toHaveBeenCalled();
    expect(tx.trade?.update).not.toHaveBeenCalled();
    expect(tx.quest?.create).not.toHaveBeenCalled();
    expect(tx.quest?.update).not.toHaveBeenCalled();
  });
});
