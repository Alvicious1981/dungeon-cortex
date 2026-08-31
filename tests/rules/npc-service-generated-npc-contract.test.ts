import { beforeEach, describe, expect, it, vi } from "vitest";

type CampaignFixture = {
  id: string;
  userId: string;
};

type NpcFixture = {
  id: string;
  campaignId: string;
  seed: string;
  role: string;
  name: string;
  maxHp: number;
  hp: number;
  ac: number;
  notes?: string | null;
  race?: string | null;
  profession?: string | null;
  alignment?: string | null;
  abilityScores?: Record<string, number> | null;
  traits?: Record<string, unknown> | null;
  disposition?: number | null;
  hasMetPlayer?: boolean;
};

type GeneratedNpcDescriptor = {
  campaignId?: string;
  seed?: string;
  role?: string;
  name: string;
  maxHp: number;
  hp: number;
  ac: number;
  notes?: string | null;
  race?: string | null;
  profession?: string | null;
  alignment?: string | null;
  abilityScores?: Record<string, number>;
  traits?: Record<string, unknown>;
};

type GeneratedNpcTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  nPC: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  combatant: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  encounter: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  quest: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  trade: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  partyInventory: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  campaignTime: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  travelState: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

type UpsertGeneratedNpcInput = {
  campaignId: string;
  userId?: string;
  npcSeed?: string;
  role?: string;
  descriptor: GeneratedNpcDescriptor;
  disposition?: number;
  tx: GeneratedNpcTx;
};

type GeneratedNpcServiceResult = {
  ok?: boolean;
  campaignId?: string;
  npcId?: string;
  seed?: string;
  name?: string;
  race?: string | null;
  profession?: string | null;
  alignment?: string | null;
  abilityScores?: unknown;
  traits?: unknown;
  created?: boolean;
  updated?: boolean;
  npc?: NpcFixture;
  facts?: Record<string, unknown>;
  narrative?: unknown;
  text?: unknown;
  prose?: unknown;
  message?: unknown;
};

type UpsertGeneratedNpc = (
  input: UpsertGeneratedNpcInput
) => Promise<GeneratedNpcServiceResult>;

type TrackNpcState = (input: {
  campaignId: string;
  npcSeed?: string;
  role?: string;
  descriptor: GeneratedNpcDescriptor;
  tx: GeneratedNpcTx;
}) => Promise<GeneratedNpcServiceResult>;

type EstablishInitialNpcDisposition = (input: {
  campaignId: string;
  npcSeed: string;
  disposition: number;
  personalityTags?: Record<string, unknown>;
  descriptor?: GeneratedNpcDescriptor;
  tx: GeneratedNpcTx;
}) => Promise<GeneratedNpcServiceResult>;

type ResolveSocialCheck = (input: {
  campaignId: string;
  characterId: string;
  npcSeed: string;
  approach: "persuade" | "intimidate" | "deceive";
  tx: {
    campaign: { findUnique: ReturnType<typeof vi.fn> };
    character: { findUnique: ReturnType<typeof vi.fn> };
    nPC: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
}) => Promise<GeneratedNpcServiceResult>;

const baseCampaigns: CampaignFixture[] = [
  { id: "campaign-1", userId: "user-1" },
  { id: "campaign-2", userId: "user-2" },
];

const baseNpcs: NpcFixture[] = [
  {
    id: "npc-1",
    campaignId: "campaign-1",
    seed: "gate_guard",
    role: "guard",
    name: "Tovin",
    maxHp: 11,
    hp: 5,
    ac: 16,
    notes: "Keeps watch at the north gate.",
    race: "human",
    profession: "guard",
    alignment: "lawful neutral",
    abilityScores: { STR: 13, DEX: 12, CON: 12, INT: 10, WIS: 11, CHA: 10 },
    traits: { personality: "curt", ideal: "order", bond: "gate", flaw: "suspicious" },
    disposition: -1,
    hasMetPlayer: true,
  },
  {
    id: "npc-2",
    campaignId: "campaign-2",
    seed: "gate_guard",
    role: "guard",
    name: "Other Tovin",
    maxHp: 11,
    hp: 11,
    ac: 16,
    disposition: 1,
    hasMetPlayer: true,
  },
];

async function loadNpcService(): Promise<{
  upsertGeneratedNpc: UpsertGeneratedNpc | undefined;
  trackNpcState: TrackNpcState;
  establishInitialNpcDisposition: EstablishInitialNpcDisposition;
}> {
  const modulePath = "../../lib/rules/npc-service";
  const service = await import(modulePath);
  return {
    upsertGeneratedNpc: service["upsertGeneratedNpc"] as UpsertGeneratedNpc | undefined,
    trackNpcState: service["trackNpcState"] as TrackNpcState,
    establishInitialNpcDisposition:
      service["establishInitialNpcDisposition"] as EstablishInitialNpcDisposition,
  };
}

async function loadSocialService(): Promise<{ resolveSocialCheck: ResolveSocialCheck }> {
  const modulePath = "../../lib/rules/social-service";
  const service = await import(modulePath);
  return {
    resolveSocialCheck: service["resolveSocialCheck"] as ResolveSocialCheck,
  };
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  npcs?: NpcFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const npcs: NpcFixture[] = (options?.npcs ?? baseNpcs).map((npc) => ({
    ...npc,
    abilityScores: npc.abilityScores ? { ...npc.abilityScores } : npc.abilityScores,
    traits: npc.traits ? { ...npc.traits } : npc.traits,
  }));

  const tx: GeneratedNpcTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaigns.find((campaign) => campaign.id === where.id) ?? null
      ),
      update: vi.fn(),
    },
    nPC: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        findNpcByWhere(npcs, where)
      ),
      create: vi.fn(async ({ data }: { data: Omit<NpcFixture, "id"> }) => {
        const npc: NpcFixture = { id: `created-npc-${npcs.length + 1}`, ...data };
        npcs.push(npc);
        return { ...npc };
      }),
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
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: Record<string, unknown>;
          create: Omit<NpcFixture, "id">;
          update: Partial<NpcFixture>;
        }) => {
          const existing = findNpcByWhere(npcs, where);
          if (existing) {
            Object.assign(existing, update);
            return { ...existing };
          }

          const npc: NpcFixture = { id: `created-npc-${npcs.length + 1}`, ...create };
          npcs.push(npc);
          return { ...npc };
        }
      ),
    },
    character: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    combatant: {
      create: vi.fn(),
      update: vi.fn(),
    },
    encounter: {
      create: vi.fn(),
      update: vi.fn(),
    },
    quest: {
      create: vi.fn(),
      update: vi.fn(),
    },
    trade: {
      create: vi.fn(),
      update: vi.fn(),
    },
    partyInventory: {
      create: vi.fn(),
      update: vi.fn(),
    },
    campaignTime: {
      create: vi.fn(),
      update: vi.fn(),
    },
    travelState: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  return { campaigns, npcs, tx };
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

function generatedDescriptor(
  overrides?: Partial<GeneratedNpcDescriptor>
): GeneratedNpcDescriptor {
  return {
    seed: "harbor_scribe",
    role: "commoner",
    name: "Elian Reed",
    maxHp: 8,
    hp: 8,
    ac: 10,
    notes: "Keeps port ledgers.",
    race: "elf",
    profession: "scribe",
    alignment: "neutral good",
    abilityScores: { STR: 8, DEX: 12, CON: 10, INT: 14, WIS: 13, CHA: 11 },
    traits: {
      personality: "precise",
      ideal: "knowledge",
      bond: "the harbor archive",
      flaw: "overly cautious",
    },
    ...overrides,
  };
}

function generatedNpcInput(
  tx: GeneratedNpcTx,
  overrides?: Partial<UpsertGeneratedNpcInput>
): UpsertGeneratedNpcInput {
  return {
    campaignId: "campaign-1",
    userId: "user-1",
    npcSeed: "harbor_scribe",
    role: "commoner",
    descriptor: generatedDescriptor(),
    tx,
    ...overrides,
  };
}

function expectUpsertGeneratedNpc(
  fn: UpsertGeneratedNpc | undefined
): UpsertGeneratedNpc {
  expect(typeof fn).toBe("function");
  return fn as UpsertGeneratedNpc;
}

function expectStructuredFacts(result: GeneratedNpcServiceResult) {
  expect(result).toMatchObject({ ok: true });
  expect(result.facts ?? result).toEqual(expect.any(Object));
}

function expectNoNarrativeText(result: GeneratedNpcServiceResult) {
  expect(result.narrative).toBeUndefined();
  expect(result.text).toBeUndefined();
  expect(result.prose).toBeUndefined();
  expect(result.message).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(
    /\b(narration|narrative|prose|flavorText|boxed text)\b/i
  );
}

function expectNoForbiddenRetroTerms(result: unknown) {
  const serialized = JSON.stringify(result);
  for (const fragments of [
    ["TH", "AC", "0"],
    ["descending", "AC"],
    ["AC", "descendente"],
    ["saving", "throw", "vs"],
    ["save", "vs", "death"],
    ["save", "vs", "wands"],
    ["gold", "for", "XP"],
    ["XP", "por", "oro"],
    ["AD", "&", "D"],
    ["OS", "R"],
  ]) {
    expect(serialized).not.toContain(fragments.join(""));
    expect(serialized).not.toContain(fragments.join(" "));
  }
}

function expectNoUnrelatedWrites(tx: GeneratedNpcTx) {
  expect(tx.character.update).not.toHaveBeenCalled();
  expect(tx.inventoryItem.create).not.toHaveBeenCalled();
  expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  expect(tx.combatant.create).not.toHaveBeenCalled();
  expect(tx.combatant.update).not.toHaveBeenCalled();
  expect(tx.encounter.create).not.toHaveBeenCalled();
  expect(tx.encounter.update).not.toHaveBeenCalled();
  expect(tx.quest.create).not.toHaveBeenCalled();
  expect(tx.quest.update).not.toHaveBeenCalled();
  expect(tx.trade.create).not.toHaveBeenCalled();
  expect(tx.trade.update).not.toHaveBeenCalled();
  expect(tx.partyInventory.create).not.toHaveBeenCalled();
  expect(tx.partyInventory.update).not.toHaveBeenCalled();
  expect(tx.campaign.update).not.toHaveBeenCalled();
  expect(tx.campaignTime.create).not.toHaveBeenCalled();
  expect(tx.campaignTime.update).not.toHaveBeenCalled();
  expect(tx.travelState.create).not.toHaveBeenCalled();
  expect(tx.travelState.update).not.toHaveBeenCalled();
}

function socialTx() {
  return {
    campaign: {
      findUnique: vi.fn(async () => ({ id: "campaign-1", characterId: "character-1" })),
    },
    character: {
      findUnique: vi.fn(async () => ({
        id: "character-1",
        campaignId: "campaign-1",
        stats: { CHA: 14 },
      })),
    },
    nPC: {
      findUnique: vi.fn(async () => ({
        id: "npc-1",
        campaignId: "campaign-1",
        seed: "gate_guard",
        name: "Tovin",
        disposition: 0,
        hasMetPlayer: true,
      })),
      update: vi.fn(async () => ({
        id: "npc-1",
        campaignId: "campaign-1",
        seed: "gate_guard",
        name: "Tovin",
        disposition: 2,
        hasMetPlayer: true,
      })),
    },
  };
}

describe("npc-service generated NPC persistence contract", () => {
  let upsertGeneratedNpc: UpsertGeneratedNpc | undefined;
  let trackNpcState: TrackNpcState;
  let establishInitialNpcDisposition: EstablishInitialNpcDisposition;

  beforeEach(async () => {
    ({
      upsertGeneratedNpc,
      trackNpcState,
      establishInitialNpcDisposition,
    } = await loadNpcService());
  });

  it("exports upsertGeneratedNpc as the generated NPC persistence entrypoint", () => {
    expectUpsertGeneratedNpc(upsertGeneratedNpc);
  });

  it("rejects a missing campaign", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx({ campaigns: [] });

    await expect(fn(generatedNpcInput(tx))).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });

    expect(tx.nPC.upsert).not.toHaveBeenCalled();
  });

  it("rejects a campaign that does not belong to the supplied user", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await expect(
      fn(generatedNpcInput(tx, { userId: "user-2" }))
    ).rejects.toMatchObject({ code: "CAMPAIGN_OWNERSHIP_MISMATCH" });

    expect(tx.nPC.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid generated NPC input", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await expect(
      fn(
        generatedNpcInput(tx, {
          descriptor: generatedDescriptor({ maxHp: 0 }),
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_NPC_PAYLOAD" });

    expect(tx.nPC.upsert).not.toHaveBeenCalled();
  });

  it("rejects a generated NPC without a name", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await expect(
      fn(
        generatedNpcInput(tx, {
          descriptor: generatedDescriptor({ name: "" }),
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_NPC_PAYLOAD" });

    expect(tx.nPC.upsert).not.toHaveBeenCalled();
  });

  it("rejects generated NPC data with a conflicting campaignId", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await expect(
      fn(
        generatedNpcInput(tx, {
          descriptor: generatedDescriptor({ campaignId: "campaign-2" }),
        })
      )
    ).rejects.toMatchObject({ code: "NPC_OWNERSHIP_MISMATCH" });

    expect(tx.nPC.upsert).not.toHaveBeenCalled();
  });

  it("persists generated NPCs with basic fields", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { npcs, tx } = createTx();

    const result = await fn(generatedNpcInput(tx));

    expect(npcs.at(-1)).toMatchObject({
      campaignId: "campaign-1",
      seed: "harbor_scribe",
      role: "commoner",
      name: "Elian Reed",
      maxHp: 8,
      hp: 8,
      ac: 10,
      notes: "Keeps port ledgers.",
    });
    expect(result).toMatchObject({
      ok: true,
      campaignId: "campaign-1",
      npcId: expect.any(String),
      name: "Elian Reed",
    });
  });

  it("persists generated NPC rich fields", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { npcs, tx } = createTx();

    const result = await fn(generatedNpcInput(tx));

    expect(npcs.at(-1)).toMatchObject({
      race: "elf",
      profession: "scribe",
      alignment: "neutral good",
      abilityScores: { STR: 8, DEX: 12, CON: 10, INT: 14, WIS: 13, CHA: 11 },
      traits: {
        personality: "precise",
        ideal: "knowledge",
        bond: "the harbor archive",
        flaw: "overly cautious",
      },
    });
    expect(result.facts ?? result).toMatchObject({
      race: "elf",
      profession: "scribe",
      alignment: "neutral good",
    });
  });

  it("can establish initial disposition when supplied by generated NPC flow", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { npcs, tx } = createTx();

    await fn(generatedNpcInput(tx, { disposition: 2 }));

    expect(npcs.at(-1)).toMatchObject({
      disposition: 2,
    });
  });

  it("does not clear existing mutable fields when refreshing a generated NPC", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { npcs, tx } = createTx();

    await fn(
      generatedNpcInput(tx, {
        npcSeed: "gate_guard",
        role: "guard",
        descriptor: generatedDescriptor({
          seed: "gate_guard",
          role: "guard",
          name: "Tovin",
          maxHp: 11,
          hp: 11,
          ac: 16,
          notes: undefined,
          race: "dwarf",
          profession: "watch captain",
          alignment: "lawful good",
        }),
      })
    );

    expect(npcs[0]).toMatchObject({
      hp: 5,
      disposition: -1,
      hasMetPlayer: true,
      notes: "Keeps watch at the north gate.",
      race: "dwarf",
      profession: "watch captain",
      alignment: "lawful good",
    });
  });

  it("uses deterministic upsert semantics for the same NPC seed and campaign", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { npcs, tx } = createTx();

    await fn(generatedNpcInput(tx));
    await fn(generatedNpcInput(tx));

    expect(npcs.filter((npc) => npc.seed === "harbor_scribe")).toHaveLength(1);
    expect(tx.nPC.upsert).toHaveBeenCalledTimes(2);
  });

  it("does not touch characters", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("does not touch inventory", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  });

  it("does not touch combat", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.combatant.create).not.toHaveBeenCalled();
    expect(tx.combatant.update).not.toHaveBeenCalled();
  });

  it("does not touch encounter", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.encounter.create).not.toHaveBeenCalled();
    expect(tx.encounter.update).not.toHaveBeenCalled();
  });

  it("does not touch quests", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.quest.create).not.toHaveBeenCalled();
    expect(tx.quest.update).not.toHaveBeenCalled();
  });

  it("does not touch economy", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.trade.create).not.toHaveBeenCalled();
    expect(tx.trade.update).not.toHaveBeenCalled();
    expect(tx.partyInventory.create).not.toHaveBeenCalled();
    expect(tx.partyInventory.update).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it("does not touch spell slots", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.character.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ spellSlots: expect.anything() }),
      })
    );
  });

  it("does not touch rest state", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.campaignTime.create).not.toHaveBeenCalled();
    expect(tx.campaignTime.update).not.toHaveBeenCalled();
  });

  it("does not touch exploration state", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.travelState.create).not.toHaveBeenCalled();
    expect(tx.travelState.update).not.toHaveBeenCalled();
  });

  it("does not call AI", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not return long narrative prose", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    const result = await fn(generatedNpcInput(tx));

    expectNoNarrativeText(result);
  });

  it("returns structured generated NPC facts", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    const result = await fn(generatedNpcInput(tx));

    expectStructuredFacts(result);
    expect(result.facts ?? result).toMatchObject({
      campaignId: "campaign-1",
      npcId: expect.any(String),
      seed: "harbor_scribe",
      name: "Elian Reed",
      created: true,
    });
  });

  it("uses the injected tx/db instead of a real database", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    await fn(generatedNpcInput(tx));

    expect(tx.campaign.findUnique).toHaveBeenCalled();
    expect(tx.nPC.upsert).toHaveBeenCalled();
  });

  it("keeps compatibility with the current generateAndTrackNPC summary shape", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    const result = await fn(generatedNpcInput(tx));

    expect(result).toMatchObject({
      ok: true,
      seed: "harbor_scribe",
      name: "Elian Reed",
      race: "elf",
      profession: "scribe",
      alignment: "neutral good",
      traits: generatedDescriptor().traits,
    });
  });

  it("does not break trackNPC through trackNpcState", async () => {
    const { tx } = createTx();

    const result = await trackNpcState({
      campaignId: "campaign-1",
      npcSeed: "harbor_scribe",
      role: "commoner",
      descriptor: generatedDescriptor(),
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      campaignId: "campaign-1",
      name: "Elian Reed",
    });
  });

  it("does not break establishInitialDisposition through establishInitialNpcDisposition", async () => {
    const { tx } = createTx({
      npcs: [
        {
          ...baseNpcs[0]!,
          hasMetPlayer: false,
          disposition: null,
        },
      ],
    });

    const result = await establishInitialNpcDisposition({
      campaignId: "campaign-1",
      npcSeed: "gate_guard",
      disposition: 2,
      personalityTags: { motivation: "duty" },
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      campaignId: "campaign-1",
      disposition: 2,
    });
  });

  it("does not break socialCheck", async () => {
    const { resolveSocialCheck } = await loadSocialService();
    const tx = socialTx();

    const result = await resolveSocialCheck({
      campaignId: "campaign-1",
      characterId: "character-1",
      npcSeed: "gate_guard",
      approach: "persuade",
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      campaignId: "campaign-1",
      npcSeed: "gate_guard",
    });
  });

  it("does not introduce forbidden retro rules or jargon", async () => {
    const fn = expectUpsertGeneratedNpc(upsertGeneratedNpc);
    const { tx } = createTx();

    const result = await fn(generatedNpcInput(tx));

    expectNoForbiddenRetroTerms(result);
    expectNoUnrelatedWrites(tx);
  });
});
