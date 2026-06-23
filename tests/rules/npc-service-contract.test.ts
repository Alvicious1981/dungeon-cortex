import { beforeEach, describe, expect, it, vi } from "vitest";

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
  disposition?: number | null;
  hasMetPlayer?: boolean;
  traits?: Record<string, unknown> | null;
  personalityTags?: Record<string, unknown> | null;
  merchant?: Record<string, unknown> | null;
};

type CampaignFixture = {
  id: string;
};

type NpcTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  nPC: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

type NpcDescriptorFixture = {
  seed: string;
  role: string;
  name: string;
  maxHp: number;
  hp: number;
  ac: number;
  abilityScores?: Record<string, number>;
  notes?: string;
  traits?: Record<string, unknown>;
};

type MerchantDescriptorFixture = NpcDescriptorFixture & {
  archetype: string;
  inventory: Array<Record<string, unknown>>;
  buyModifier?: number;
  sellModifier?: number;
};

type TrackNpcStateInput = {
  campaignId: string;
  npcId?: string;
  npcSeed?: string;
  descriptor: NpcDescriptorFixture;
  tx: NpcTx;
};

type TrackMerchantStateInput = {
  campaignId: string;
  merchantId?: string;
  npcSeed?: string;
  descriptor: MerchantDescriptorFixture;
  tx: NpcTx;
};

type EstablishInitialNpcDispositionInput = {
  campaignId: string;
  npcId: string;
  disposition: number;
  traits?: Record<string, unknown>;
  tx: NpcTx;
};

type NpcServiceResult = {
  ok?: boolean;
  campaignId?: string;
  npcId?: string;
  merchantId?: string;
  facts?: unknown;
  narrative?: unknown;
  text?: unknown;
  prose?: unknown;
  message?: unknown;
};

type TrackNpcState = (
  input: TrackNpcStateInput
) => Promise<NpcServiceResult>;

type TrackMerchantState = (
  input: TrackMerchantStateInput
) => Promise<NpcServiceResult>;

type EstablishInitialNpcDisposition = (
  input: EstablishInitialNpcDispositionInput
) => Promise<NpcServiceResult>;

const baseCampaigns: CampaignFixture[] = [
  { id: "campaign-1" },
  { id: "campaign-2" },
];

const baseNpcs: NpcFixture[] = [
  {
    id: "npc-1",
    campaignId: "campaign-1",
    seed: "harbor_innkeeper",
    role: "commoner",
    name: "Mara Vale",
    maxHp: 8,
    hp: 8,
    ac: 10,
    notes: "Runs the dockside inn.",
    disposition: 0,
    hasMetPlayer: false,
    traits: { manner: "direct" },
  },
  {
    id: "npc-2",
    campaignId: "campaign-1",
    seed: "gate_guard",
    role: "guard",
    name: "Tovin",
    maxHp: 11,
    hp: 11,
    ac: 16,
    disposition: 1,
    hasMetPlayer: true,
  },
  {
    id: "npc-3",
    campaignId: "campaign-2",
    seed: "harbor_innkeeper",
    role: "commoner",
    name: "Other Mara",
    maxHp: 8,
    hp: 8,
    ac: 10,
    disposition: -1,
    hasMetPlayer: false,
  },
];

async function loadNpcService(): Promise<{
  trackNpcState: TrackNpcState;
  trackMerchantState: TrackMerchantState;
  establishInitialNpcDisposition: EstablishInitialNpcDisposition;
}> {
  const modulePath = "../../lib/rules/npc-service";
  const mod = await import(modulePath);
  return {
    trackNpcState: mod.trackNpcState as TrackNpcState,
    trackMerchantState: mod.trackMerchantState as TrackMerchantState,
    establishInitialNpcDisposition:
      mod.establishInitialNpcDisposition as EstablishInitialNpcDisposition,
  };
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  npcs?: NpcFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const npcs = (options?.npcs ?? baseNpcs).map((npc) => ({ ...npc }));

  const tx: NpcTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaigns.find((campaign) => campaign.id === where.id) ?? null
      ),
    },
    nPC: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        findNpcByWhere(npcs, where)
      ),
      findFirst: vi.fn(async ({ where }: { where: Partial<NpcFixture> }) =>
        npcs.find((npc) => matchesNpcWhere(npc, where)) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Omit<NpcFixture, "id"> }) => {
        const npc = {
          id: `created-npc-${npcs.length + 1}`,
          ...data,
        };
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
          const npc = {
            id: `created-npc-${npcs.length + 1}`,
            ...create,
          };
          npcs.push(npc);
          return { ...npc };
        }
      ),
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

  return npcs.find((npc) => matchesNpcWhere(npc, where)) ?? null;
}

function matchesNpcWhere(npc: NpcFixture, where: Partial<NpcFixture>): boolean {
  return Object.entries(where).every(
    ([key, expected]) => npc[key as keyof NpcFixture] === expected
  );
}

function npcDescriptor(
  overrides?: Partial<NpcDescriptorFixture>
): NpcDescriptorFixture {
  return {
    seed: "harbor_scribe",
    role: "commoner",
    name: "Elian Reed",
    maxHp: 8,
    hp: 8,
    ac: 10,
    abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 12, WIS: 11, CHA: 13 },
    notes: "Keeps port ledgers.",
    traits: { manner: "precise" },
    ...overrides,
  };
}

function merchantDescriptor(
  overrides?: Partial<MerchantDescriptorFixture>
): MerchantDescriptorFixture {
  return {
    ...npcDescriptor({ seed: "market_blacksmith", name: "Brenna Coal" }),
    archetype: "blacksmith",
    inventory: [{ name: "Hammer", type: "tool", buyPriceGP: 1 }],
    buyModifier: 1,
    sellModifier: 0.5,
    ...overrides,
  };
}

function trackNpcInput(
  tx: NpcTx,
  overrides?: Partial<TrackNpcStateInput>
): TrackNpcStateInput {
  return {
    campaignId: "campaign-1",
    npcSeed: "harbor_scribe",
    descriptor: npcDescriptor(),
    tx,
    ...overrides,
  };
}

function trackMerchantInput(
  tx: NpcTx,
  overrides?: Partial<TrackMerchantStateInput>
): TrackMerchantStateInput {
  return {
    campaignId: "campaign-1",
    npcSeed: "market_blacksmith",
    descriptor: merchantDescriptor(),
    tx,
    ...overrides,
  };
}

function dispositionInput(
  tx: NpcTx,
  overrides?: Partial<EstablishInitialNpcDispositionInput>
): EstablishInitialNpcDispositionInput {
  return {
    campaignId: "campaign-1",
    npcId: "npc-1",
    disposition: 2,
    traits: { manner: "helpful" },
    tx,
    ...overrides,
  };
}

function findNpc(npcs: NpcFixture[], id: string): NpcFixture {
  const npc = npcs.find((candidate) => candidate.id === id);
  if (!npc) throw new Error(`Missing NPC ${id}`);
  return npc;
}

function expectStructuredFacts(result: NpcServiceResult) {
  expect(result).toMatchObject({ ok: true });
  expect(result.facts ?? result).toEqual(expect.any(Object));
}

function expectNoNarrativeText(result: NpcServiceResult) {
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

describe("npc-service contract", () => {
  let trackNpcState: TrackNpcState;
  let trackMerchantState: TrackMerchantState;
  let establishInitialNpcDisposition: EstablishInitialNpcDisposition;

  beforeEach(async () => {
    ({
      trackNpcState,
      trackMerchantState,
      establishInitialNpcDisposition,
    } = await loadNpcService());
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaigns: [] });

    await expect(trackNpcState(trackNpcInput(tx))).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });

    expect(tx.nPC.create).not.toHaveBeenCalled();
    expect(tx.nPC.update).not.toHaveBeenCalled();
    expect(tx.nPC.upsert).not.toHaveBeenCalled();
  });

  it("rejects a missing NPC when updating an existing NPC", async () => {
    const { tx } = createTx();

    await expect(
      trackNpcState(trackNpcInput(tx, { npcId: "missing-npc", npcSeed: undefined }))
    ).rejects.toMatchObject({ code: "NPC_NOT_FOUND" });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("rejects an NPC from another campaign", async () => {
    const { tx } = createTx();

    await expect(
      establishInitialNpcDisposition(
        dispositionInput(tx, { npcId: "npc-3", campaignId: "campaign-1" })
      )
    ).rejects.toMatchObject({ code: "NPC_OWNERSHIP_MISMATCH" });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("validates initial disposition range", async () => {
    const { tx } = createTx();

    await expect(
      establishInitialNpcDisposition(dispositionInput(tx, { disposition: 99 }))
    ).rejects.toMatchObject({ code: "INVALID_DISPOSITION" });

    expect(tx.nPC.update).not.toHaveBeenCalled();
  });

  it("trackNpcState creates an NPC for the requested campaign", async () => {
    const { npcs, tx } = createTx();

    const result = await trackNpcState(trackNpcInput(tx));

    expect(npcs.at(-1)).toMatchObject({
      campaignId: "campaign-1",
      seed: "harbor_scribe",
      name: "Elian Reed",
    });
    expect(result).toMatchObject({
      ok: true,
      campaignId: "campaign-1",
      npcId: expect.any(String),
    });
  });

  it("trackNpcState updates an existing NPC for the requested campaign", async () => {
    const { npcs, tx } = createTx();

    const result = await trackNpcState(
      trackNpcInput(tx, {
        npcSeed: "harbor_innkeeper",
        descriptor: npcDescriptor({
          seed: "harbor_innkeeper",
          name: "Mara Vale",
          notes: "Now trusts the party with dock rumors.",
        }),
      })
    );

    expect(findNpc(npcs, "npc-1")).toMatchObject({
      campaignId: "campaign-1",
      notes: "Now trusts the party with dock rumors.",
    });
    expect(result).toMatchObject({ ok: true, campaignId: "campaign-1" });
  });

  it("trackMerchantState creates or updates merchant NPC state for the requested campaign", async () => {
    const { npcs, tx } = createTx();

    const result = await trackMerchantState(trackMerchantInput(tx));

    expect(npcs.at(-1)).toMatchObject({
      campaignId: "campaign-1",
      seed: "market_blacksmith",
      name: "Brenna Coal",
    });
    expect(JSON.stringify(npcs.at(-1))).toContain("blacksmith");
    expect(result).toMatchObject({
      ok: true,
      campaignId: "campaign-1",
      merchantId: expect.any(String),
    });
  });

  it("establishInitialNpcDisposition updates disposition, met flag, and valid traits", async () => {
    const { npcs, tx } = createTx();

    const result = await establishInitialNpcDisposition(dispositionInput(tx));

    expect(findNpc(npcs, "npc-1")).toMatchObject({
      disposition: 2,
      hasMetPlayer: true,
    });
    expect(JSON.stringify(findNpc(npcs, "npc-1"))).toContain("helpful");
    expect(result).toMatchObject({ ok: true, campaignId: "campaign-1", npcId: "npc-1" });
  });

  it("does not touch NPCs from another campaign", async () => {
    const { npcs, tx } = createTx();

    await establishInitialNpcDisposition(dispositionInput(tx));

    expect(findNpc(npcs, "npc-3")).toMatchObject({
      campaignId: "campaign-2",
      disposition: -1,
      hasMetPlayer: false,
    });
  });

  it("does not touch other NPCs from the same campaign", async () => {
    const { npcs, tx } = createTx();

    await establishInitialNpcDisposition(dispositionInput(tx));

    expect(findNpc(npcs, "npc-2")).toMatchObject({
      campaignId: "campaign-1",
      disposition: 1,
      hasMetPlayer: true,
    });
  });

  it("returns structured facts", async () => {
    const { tx } = createTx();

    const result = await establishInitialNpcDisposition(dispositionInput(tx));

    expectStructuredFacts(result);
    expect(result.facts ?? result).toEqual(
      expect.objectContaining({
        campaignId: "campaign-1",
        npcId: "npc-1",
        disposition: 2,
      })
    );
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();

    const result = await trackNpcState(trackNpcInput(tx));

    expectNoNarrativeText(result);
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await trackMerchantState(trackMerchantInput(tx));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not introduce forbidden retro rules or jargon", async () => {
    const { tx } = createTx();

    const result = await establishInitialNpcDisposition(dispositionInput(tx));

    expectNoForbiddenRetroTerms(result);
  });
});
