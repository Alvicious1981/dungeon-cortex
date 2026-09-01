import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CampaignFixture = {
  id: string;
  characterId: string;
};

type CharacterFixture = {
  id: string;
  campaignId: string;
  stats: Record<string, number>;
  level?: number;
  skillProficiencies?: string[];
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
  intent?: string;
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
  { id: "campaign-1", characterId: "character-1" },
  { id: "campaign-2", characterId: "character-2" },
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
      findUnique: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { id: string };
          select?: Record<string, boolean>;
        }) => {
          const character = characters.find((c) => c.id === where.id);
          if (!character) return null;
          if (!select) return character;
          const projected: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) {
              projected[key] = (character as unknown as Record<string, unknown>)[key];
            }
          }
          return projected;
        }
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
    intent: "Ask the guard to allow entry.",
    tx,
    ...overrides,
  };
}

function findNpc(npcs: NpcFixture[], id: string): NpcFixture {
  const npc = npcs.find((candidate) => candidate.id === id);
  if (!npc) throw new Error(`Missing NPC ${id}`);
  return npc;
}

/**
 * Pins the natural d20 result `resolveAbilityCheck` (via rollDie -> Math.random)
 * will produce, without reimplementing dice math here. `resolveSocialCheck`
 * no longer accepts a manual roll/dc override — the DC comes from the NPC's
 * attitude and the roll comes from the dice, exactly like every other SRD
 * ability check, so tests drive it the same way social-logic.test.ts does.
 */
function mockNaturalRoll(natural: number): void {
  vi.spyOn(Math, "random").mockReturnValue((natural - 0.5) / 20);
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

/**
 * A Prisma double that behaves like Prisma on the two points that matter:
 * it returns only what `select` named, and it refuses a field the model does
 * not have. The permissive fake it replaces returned whatever it was asked
 * for, which is how `campaignId` came to be selected from `Character` — a
 * model with no such scalar — and why the ownership check reading it has
 * never once fired.
 */
const CHARACTER_FIELDS = ["id", "stats", "level", "skillProficiencies"] as const;
const NPC_FIELDS = ["id", "campaignId", "seed", "name", "disposition", "hasMetPlayer"] as const;
const CAMPAIGN_FIELDS = ["id", "characterId", "userId", "status"] as const;

function project<T extends Record<string, unknown>>(
  model: string,
  row: T | null,
  known: readonly string[],
  select?: Record<string, boolean>
): Record<string, unknown> | null {
  if (!select) return row;
  for (const field of Object.keys(select)) {
    if (!known.includes(field)) {
      throw new Error(`Unknown field \`${field}\` for select statement on model \`${model}\`.`);
    }
  }
  if (row === null) return null;
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(select)) {
    if (select[field]) out[field] = row[field as keyof T];
  }
  return out;
}

function makeSocialDb(rows: {
  campaign: Record<string, unknown> | null;
  character: Record<string, unknown> | null;
  npc: Record<string, unknown> | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    campaign: {
      findUnique: async (args: { where?: unknown; select?: Record<string, boolean> }) =>
        project("Campaign", rows.campaign, CAMPAIGN_FIELDS, args.select),
    },
    character: {
      findUnique: async (args: { where?: unknown; select?: Record<string, boolean> }) =>
        project("Character", rows.character, CHARACTER_FIELDS, args.select),
    },
    nPC: {
      findUnique: async (args: { where?: unknown; select?: Record<string, boolean> }) =>
        project("NPC", rows.npc, NPC_FIELDS, args.select),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { ...rows.npc, ...args.data };
      },
    },
  };
}

describe("makeSocialDb (a Prisma double that honours select)", () => {
  it("returns only the fields a caller selected", async () => {
    const db = makeSocialDb({
      campaign: { id: "camp_1", characterId: "char_1", userId: "user_1" },
      character: { id: "char_1", stats: { CHA: 14 }, level: 5, skillProficiencies: ["Persuasion"] },
      npc: { id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", name: "Greta", disposition: 8, hasMetPlayer: true },
    });

    const row = await db.character.findUnique({
      where: { id: "char_1" },
      select: { id: true, stats: true },
    });

    expect(row).toEqual({ id: "char_1", stats: { CHA: 14 } });
    expect(row).not.toHaveProperty("level");
  });

  it("refuses a select for a field the model does not have", async () => {
    const db = makeSocialDb({
      campaign: { id: "camp_1", characterId: "char_1", userId: "user_1" },
      character: { id: "char_1", stats: {}, level: 1, skillProficiencies: [] },
      npc: { id: "npc_1", campaignId: "camp_1", seed: "s", name: "n", disposition: 0, hasMetPlayer: true },
    });

    await expect(
      db.character.findUnique({
        where: { id: "char_1" },
        select: { id: true, campaignId: true },
      })
    ).rejects.toThrow(/Unknown field .*campaignId.* on model .*Character/);
  });
});

describe("social-service resolveSocialCheck contract", () => {
  let resolveSocialCheck: ResolveSocialCheck;

  beforeEach(async () => {
    ({ resolveSocialCheck } = await loadSocialService());
  });

  afterEach(() => {
    vi.spyOn(Math, "random").mockRestore();
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
    mockNaturalRoll(1); // a natural 1 auto-fails the ability check

    const result = await resolveSocialCheck(input(tx, { approach: "intimidate" }));

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
    mockNaturalRoll(20); // a natural 20 auto-succeeds the ability check

    const result = await resolveSocialCheck(input(tx));

    expect(findNpc(npcs, "npc-1").disposition).toBe(10);
    expect(result.dispositionAfter).toBe(10);
  });

  it("improves disposition deterministically on valid success", async () => {
    const { npcs, tx } = createTx();
    mockNaturalRoll(15); // 15 + CHA 14's +2 = 17, past the Indifferent DC of 15

    const result = await resolveSocialCheck(input(tx));

    expect(result).toMatchObject({
      ok: true,
      success: true,
      dispositionBefore: 0,
      dispositionAfter: 4,
    });
    expect(findNpc(npcs, "npc-1").disposition).toBe(4);
  });

  it("conserves — and does not specially worsen — disposition on any failed check", async () => {
    const { npcs, tx } = createTx();
    mockNaturalRoll(5); // 5 + 2 = 7, short of the Indifferent DC of 15

    const result = await resolveSocialCheck(input(tx, { approach: "deceive" }));

    expect(result).toMatchObject({
      ok: true,
      success: false,
      dispositionBefore: 0,
      dispositionAfter: -4,
    });
    expect(findNpc(npcs, "npc-1").disposition).toBe(-4);
  });

  it("shifts disposition the same amount on a failed intimidation check as any other approach", async () => {
    const { npcs, tx } = createTx();
    mockNaturalRoll(5);

    const result = await resolveSocialCheck(input(tx, { approach: "intimidate" }));

    expect(result).toMatchObject({
      ok: true,
      success: false,
      dispositionBefore: 0,
      dispositionAfter: -4,
    });
    expect(findNpc(npcs, "npc-1").disposition).toBe(-4);
  });

  it("does not touch other NPCs", async () => {
    const { npcs, tx } = createTx();
    mockNaturalRoll(15);

    await resolveSocialCheck(input(tx));

    expect(findNpc(npcs, "npc-2")).toMatchObject({
      campaignId: "campaign-1",
      disposition: 2,
    });
  });

  it("does not touch other characters", async () => {
    const { characters, tx } = createTx();
    mockNaturalRoll(15);

    await resolveSocialCheck(input(tx));

    expect(characters).toContainEqual({
      id: "character-2",
      campaignId: "campaign-2",
      stats: { CHA: 8 },
    });
    expect(tx.character.findUnique).toHaveBeenCalled();
  });

  it("does not touch another campaign", async () => {
    const { npcs, tx } = createTx();
    mockNaturalRoll(15);

    await resolveSocialCheck(input(tx));

    expect(findNpc(npcs, "npc-3")).toMatchObject({
      campaignId: "campaign-2",
      disposition: -1,
    });
  });

  it("returns structured facts", async () => {
    const { tx } = createTx();
    mockNaturalRoll(15);

    const result = await resolveSocialCheck(input(tx));

    expectStructuredFacts(result);
    expect(result.facts ?? result).toEqual(
      expect.objectContaining({
        campaignId: "campaign-1",
        characterId: "character-1",
        npcId: "npc-1",
        approach: "persuade",
        dispositionAfter: 4,
      })
    );
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();
    mockNaturalRoll(15);

    const result = await resolveSocialCheck(input(tx));

    expectNoNarrativeText(result);
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();
    mockNaturalRoll(15);

    await resolveSocialCheck(input(tx));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not introduce forbidden retro rules or jargon", async () => {
    const { tx } = createTx();
    mockNaturalRoll(15);

    const result = await resolveSocialCheck(input(tx));

    expectNoForbiddenRetroTerms(result);
  });

  it("keeps D&D 5e/SRD 2014 skill checks as the social-check basis", async () => {
    const { tx } = createTx();
    mockNaturalRoll(15);

    const result = await resolveSocialCheck(input(tx));

    expect(result).toMatchObject({
      roll: 15,
      dc: expect.any(Number),
      success: true,
    });
    expect(JSON.stringify(result.facts ?? result)).toMatch(/5e|SRD|d20/i);
  });

  it("applies the character's SRD proficiency bonus when the approach's skill is a known proficiency", async () => {
    const { tx } = createTx({
      characters: [
        {
          id: "character-1",
          campaignId: "campaign-1",
          stats: { CHA: 14 },
          level: 5,
          skillProficiencies: ["Persuasion"],
        },
        { id: "character-2", campaignId: "campaign-2", stats: { CHA: 8 } },
      ],
    });
    mockNaturalRoll(15);

    const result = await resolveSocialCheck(input(tx, { approach: "persuade" }));

    const facts = (result.facts ?? result) as { proficiencyApplied?: number };
    expect(facts.proficiencyApplied).toBeGreaterThan(0);
  });

  it("rejects a character that does not belong to the campaign", async () => {
    const db = makeSocialDb({
      campaign: { id: "camp_1", characterId: "char_OTHER", userId: "user_1" },
      character: { id: "char_1", stats: { CHA: 10 }, level: 1, skillProficiencies: [] },
      npc: { id: "npc_1", campaignId: "camp_1", seed: "s", name: "n", disposition: 8, hasMetPlayer: true },
    });

    await expect(
      resolveSocialCheck({
        campaignId: "camp_1",
        characterId: "char_1",
        npcId: "npc_1",
        approach: "persuade",
        intent: "a room",
        tx: db as never,
      })
    ).rejects.toMatchObject({ code: "CHARACTER_OWNERSHIP_MISMATCH" });
  });

  it("does not modify commerce or quests", async () => {
    const { tx } = createTx();
    mockNaturalRoll(15);

    await resolveSocialCheck(input(tx));

    expect(tx.trade?.create).not.toHaveBeenCalled();
    expect(tx.trade?.update).not.toHaveBeenCalled();
    expect(tx.quest?.create).not.toHaveBeenCalled();
    expect(tx.quest?.update).not.toHaveBeenCalled();
  });
});
