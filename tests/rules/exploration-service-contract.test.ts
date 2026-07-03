import { beforeEach, describe, expect, it, vi } from "vitest";

type CampaignFixture = {
  id: string;
  userId: string;
  characterId: string;
  currentLocationId: string | null;
  currentNodeId: string | null;
  gold: number;
};

type CharacterFixture = {
  id: string;
  campaignId: string;
  hp: number;
  spellSlots: Record<string, { current: number; max: number }> | null;
};

type LocationFixture = {
  id: string;
  campaignId: string;
  seed: string;
  type: string;
  name: string;
  description: string;
  parentId: string | null;
};

type LocationNodeFixture = {
  id: string;
  locationId: string;
  index: number;
  name: string;
  description: string;
  feature: string;
  npcSeed: string | null;
  featureData: Record<string, unknown>;
  x: number;
  y: number;
};

type LocationEdgeFixture = {
  id: string;
  locationId: string;
  fromNodeId: string;
  toNodeId: string;
  passageType: string;
};

type EncounterFixture = {
  id: string;
  campaignId: string;
  status: string;
};

type QuestFixture = {
  id: string;
  campaignId: string;
  status: string;
};

type InventoryItemFixture = {
  id: string;
  campaignId: string;
  characterId: string;
  name: string;
  quantity: number;
};

type PartyInventoryFixture = {
  campaignId: string;
  torches: number;
  rations: number;
};

type CampaignTimeFixture = {
  campaignId: string;
  turnsSinceRest: number;
};

type ExplorationTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  location: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  locationNode: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  locationEdge: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  combatant: {
    update: ReturnType<typeof vi.fn>;
  };
  encounter: {
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
  campaignTime: {
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  partyInventory: {
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  ai: {
    generateText: ReturnType<typeof vi.fn>;
  };
};

type ExplorationDb = ExplorationTx & {
  $transaction: ReturnType<typeof vi.fn>;
};

type GeneratedLocationContent = {
  name: string;
  type: string;
  description: string;
  seed: string;
  entryNodeIndex: number;
  nodes: Array<{
    index: number;
    name: string;
    description: string;
    feature: string;
    npcSeed: string | null;
    featureData: Record<string, unknown>;
    x: number;
    y: number;
  }>;
  edges: Array<{
    fromIndex: number;
    toIndex: number;
    passageType: string;
  }>;
};

type GenerateExplorationLocationInput = {
  campaignId: string;
  userId?: string;
  locationType: string;
  seed?: string;
  parentLocationId?: string;
  generatedContent?: GeneratedLocationContent;
  tx?: ExplorationTx;
  db?: ExplorationDb;
};

type GenerateExplorationLocationResult = {
  ok: true;
  locationId: string;
  initialNodeId: string;
  entryNodeId?: string;
  nodeIds: string[];
  edgeIds: string[];
  name: string;
  type: string;
  seed: string;
  campaignUpdate?: {
    currentLocationId?: string;
    currentNodeId?: string;
  };
  facts: {
    type: "exploration_location_generated";
    campaignId: string;
    locationId: string;
    initialNodeId: string;
    nodeIds: string[];
    edgeIds: string[];
    locationType: string;
  };
  narrative?: unknown;
  text?: unknown;
  prose?: unknown;
  message?: unknown;
};

type GenerateExplorationLocation = (
  input: GenerateExplorationLocationInput
) => Promise<GenerateExplorationLocationResult>;

const baseCampaigns: CampaignFixture[] = [
  {
    id: "campaign-1",
    userId: "user-1",
    characterId: "character-1",
    currentLocationId: null,
    currentNodeId: null,
    gold: 50,
  },
  {
    id: "campaign-2",
    userId: "user-2",
    characterId: "character-2",
    currentLocationId: null,
    currentNodeId: null,
    gold: 75,
  },
];

const baseCharacters: CharacterFixture[] = [
  {
    id: "character-1",
    campaignId: "campaign-1",
    hp: 12,
    spellSlots: { "1": { current: 2, max: 2 } },
  },
  {
    id: "character-2",
    campaignId: "campaign-2",
    hp: 9,
    spellSlots: { "1": { current: 1, max: 1 } },
  },
];

const baseEncounters: EncounterFixture[] = [
  { id: "encounter-1", campaignId: "campaign-1", status: "active" },
];

const baseQuests: QuestFixture[] = [
  { id: "quest-1", campaignId: "campaign-1", status: "active" },
];

const baseInventory: InventoryItemFixture[] = [
  {
    id: "rope-1",
    campaignId: "campaign-1",
    characterId: "character-1",
    name: "Hempen Rope",
    quantity: 1,
  },
];

const basePartyInventory: PartyInventoryFixture[] = [
  { campaignId: "campaign-1", torches: 5, rations: 7 },
];

const baseCampaignTime: CampaignTimeFixture[] = [
  { campaignId: "campaign-1", turnsSinceRest: 0 },
];

const validGeneratedContent: GeneratedLocationContent = {
  name: "Silent Cistern",
  type: "dungeon",
  description: "A compact structured location used by contract tests.",
  seed: "seed-1",
  entryNodeIndex: 0,
  nodes: [
    {
      index: 0,
      name: "Entry",
      description: "The entry chamber.",
      feature: "empty",
      npcSeed: null,
      featureData: {},
      x: 0,
      y: 0,
    },
    {
      index: 1,
      name: "Gallery",
      description: "A connected gallery.",
      feature: "empty",
      npcSeed: null,
      featureData: {},
      x: 1,
      y: 0,
    },
  ],
  edges: [{ fromIndex: 0, toIndex: 1, passageType: "open" }],
};

const forbiddenRulePattern = new RegExp(
  [
    ["AD", "&", "D"].join(""),
    ["OS", "R"].join(""),
    ["TH", "AC", "0"].join(""),
    ["descending", "AC"].join(" "),
    ["AC", "descendente"].join(" "),
    ["saving", "throw", "vs"].join(" "),
    ["save", "vs", "death"].join(" "),
    ["gold", "for", "XP"].join(" "),
    ["XP", "por", "oro"].join(" "),
  ].join("|"),
  "i"
);

async function loadGenerateExplorationLocation(): Promise<GenerateExplorationLocation> {
  const modulePath = "../../lib/rules/exploration-service";
  const mod = await import(modulePath);
  return mod.generateExplorationLocation as GenerateExplorationLocation;
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  characters?: CharacterFixture[];
  locations?: LocationFixture[];
  nodes?: LocationNodeFixture[];
  edges?: LocationEdgeFixture[];
  encounters?: EncounterFixture[];
  quests?: QuestFixture[];
  inventory?: InventoryItemFixture[];
  partyInventory?: PartyInventoryFixture[];
  campaignTime?: CampaignTimeFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const characters = (options?.characters ?? baseCharacters).map((character) => ({
    ...character,
    spellSlots: character.spellSlots ? structuredClone(character.spellSlots) : null,
  }));
  const locations = (options?.locations ?? []).map((location) => ({ ...location }));
  const nodes = (options?.nodes ?? []).map((node) => ({
    ...node,
    featureData: { ...node.featureData },
  }));
  const edges = (options?.edges ?? []).map((edge) => ({ ...edge }));
  const encounters = (options?.encounters ?? baseEncounters).map((encounter) => ({
    ...encounter,
  }));
  const quests = (options?.quests ?? baseQuests).map((quest) => ({ ...quest }));
  const inventory = (options?.inventory ?? baseInventory).map((item) => ({ ...item }));
  const partyInventory = (options?.partyInventory ?? basePartyInventory).map((item) => ({
    ...item,
  }));
  const campaignTime = (options?.campaignTime ?? baseCampaignTime).map((item) => ({
    ...item,
  }));

  const tx: ExplorationTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaigns.find((campaign) => campaign.id === where.id) ?? null
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Pick<CampaignFixture, "currentLocationId" | "currentNodeId">>;
        }) => {
          const campaign = campaigns.find((candidate) => candidate.id === where.id);
          if (!campaign) throw new Error(`Missing campaign ${where.id}`);
          if (data.currentLocationId !== undefined) {
            campaign.currentLocationId = data.currentLocationId;
          }
          if (data.currentNodeId !== undefined) campaign.currentNodeId = data.currentNodeId;
          return { ...campaign };
        }
      ),
    },
    character: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        characters.find((character) => character.id === where.id) ?? null
      ),
      update: vi.fn(),
    },
    location: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where:
            | { id: string }
            | { campaignId_seed: { campaignId: string; seed: string } };
        }) => {
          if ("id" in where) {
            return locations.find((location) => location.id === where.id) ?? null;
          }
          return (
            locations.find(
              (location) =>
                location.campaignId === where.campaignId_seed.campaignId &&
                location.seed === where.campaignId_seed.seed
            ) ?? null
          );
        }
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<LocationFixture, "id" | "parentId"> & { parentId?: string | null };
        }) => {
          const location = {
            id: `location-${locations.length + 1}`,
            parentId: data.parentId ?? null,
            ...data,
          };
          locations.push(location);
          return { ...location };
        }
      ),
    },
    locationNode: {
      create: vi.fn(
        async ({ data }: { data: Omit<LocationNodeFixture, "id"> }) => {
          if (!data.locationId) throw new Error("LocationNode requires locationId");
          const location = locations.find((candidate) => candidate.id === data.locationId);
          if (!location) throw new Error(`Missing location ${data.locationId}`);
          const node = { id: `node-${nodes.length + 1}`, ...data };
          nodes.push(node);
          return { ...node };
        }
      ),
      findMany: vi.fn(async ({ where }: { where: { locationId: string } }) =>
        nodes.filter((node) => node.locationId === where.locationId)
      ),
    },
    locationEdge: {
      create: vi.fn(
        async ({ data }: { data: Omit<LocationEdgeFixture, "id"> }) => {
          const fromNode = nodes.find((node) => node.id === data.fromNodeId);
          const toNode = nodes.find((node) => node.id === data.toNodeId);
          if (!fromNode || !toNode) throw new Error("LocationEdge endpoints must exist");
          if (
            fromNode.locationId !== data.locationId ||
            toNode.locationId !== data.locationId
          ) {
            throw new Error("LocationEdge endpoints must belong to location");
          }
          const edge = { id: `edge-${edges.length + 1}`, ...data };
          edges.push(edge);
          return { ...edge };
        }
      ),
      findMany: vi.fn(async ({ where }: { where: { locationId: string } }) =>
        edges.filter((edge) => edge.locationId === where.locationId)
      ),
    },
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    combatant: {
      update: vi.fn(),
    },
    encounter: {
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
    campaignTime: {
      update: vi.fn(),
      upsert: vi.fn(),
    },
    partyInventory: {
      update: vi.fn(),
      upsert: vi.fn(),
    },
    ai: {
      generateText: vi.fn(),
    },
  };

  return {
    campaigns,
    characters,
    locations,
    nodes,
    edges,
    encounters,
    quests,
    inventory,
    partyInventory,
    campaignTime,
    tx,
  };
}

function createDb(state = createTx()): ReturnType<typeof createTx> & { db: ExplorationDb } {
  const db = {
    ...state.tx,
    $transaction: vi.fn(async (fn: (tx: ExplorationTx) => Promise<unknown>) =>
      fn(state.tx)
    ),
  };

  return { ...state, db };
}

function input(
  tx: ExplorationTx,
  overrides?: Partial<GenerateExplorationLocationInput>
): GenerateExplorationLocationInput {
  return {
    campaignId: "campaign-1",
    userId: "user-1",
    locationType: "dungeon",
    seed: "seed-1",
    generatedContent: structuredClone(validGeneratedContent),
    tx,
    ...overrides,
  };
}

function expectNoUnrelatedWrites(tx: ExplorationTx) {
  expect(tx.character.update).not.toHaveBeenCalled();
  expect(tx.inventoryItem.create).not.toHaveBeenCalled();
  expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  expect(tx.combatant.update).not.toHaveBeenCalled();
  expect(tx.encounter.update).not.toHaveBeenCalled();
  expect(tx.quest.create).not.toHaveBeenCalled();
  expect(tx.quest.update).not.toHaveBeenCalled();
  expect(tx.trade.create).not.toHaveBeenCalled();
  expect(tx.trade.update).not.toHaveBeenCalled();
  expect(tx.campaignTime.update).not.toHaveBeenCalled();
  expect(tx.campaignTime.upsert).not.toHaveBeenCalled();
  expect(tx.partyInventory.update).not.toHaveBeenCalled();
  expect(tx.partyInventory.upsert).not.toHaveBeenCalled();
}

function expectNoNarrativeText(result: GenerateExplorationLocationResult) {
  expect(result.narrative).toBeUndefined();
  expect(result.text).toBeUndefined();
  expect(result.prose).toBeUndefined();
  expect(result.message).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(
    /\b(narration|narrative|prose|flavorText|boxed text|you enter|you arrive)\b/i
  );
}

describe("exploration-service generateExplorationLocation contract", () => {
  let generateExplorationLocation: GenerateExplorationLocation;

  beforeEach(async () => {
    generateExplorationLocation = await loadGenerateExplorationLocation();
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaigns: [] });

    await expect(generateExplorationLocation(input(tx))).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });

    expect(tx.location.create).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects a campaign that does not belong to the actor", async () => {
    const { tx } = createTx();

    await expect(
      generateExplorationLocation(input(tx, { userId: "user-2" }))
    ).rejects.toMatchObject({ code: "CAMPAIGN_OWNERSHIP_MISMATCH" });

    expect(tx.location.create).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    const { tx } = createTx();

    await expect(
      generateExplorationLocation(input(tx, { locationType: "", seed: "" }))
    ).rejects.toMatchObject({ code: "INVALID_LOCATION_INPUT" });

    expect(tx.location.create).not.toHaveBeenCalled();
  });

  it("creates a valid Location", async () => {
    const { locations, tx } = createTx();

    const result = await generateExplorationLocation(input(tx));

    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      campaignId: "campaign-1",
      seed: "seed-1",
      type: "dungeon",
      name: "Silent Cistern",
    });
    expect(result).toMatchObject({
      ok: true,
      locationId: locations[0].id,
      name: "Silent Cistern",
      type: "dungeon",
    });
  });

  it("creates an initial LocationNode with a locationId", async () => {
    const { nodes, tx } = createTx();

    const result = await generateExplorationLocation(input(tx));

    expect(nodes.length).toBeGreaterThanOrEqual(1);
    expect(nodes[0]).toMatchObject({ index: 0, locationId: result.locationId });
    expect(result.initialNodeId).toBe(nodes[0].id);
  });

  it("creates LocationEdge records for connected generated nodes", async () => {
    const { edges, nodes, tx } = createTx();

    await generateExplorationLocation(input(tx));

    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(nodes.map((node) => node.id)).toContain(edges[0].fromNodeId);
    expect(nodes.map((node) => node.id)).toContain(edges[0].toNodeId);
  });

  it("updates campaign.currentLocationId for the generated location", async () => {
    const { campaigns, tx } = createTx();

    const result = await generateExplorationLocation(input(tx));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.currentLocationId).toBe(
      result.locationId
    );
    expect(tx.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "campaign-1" },
        data: expect.objectContaining({ currentLocationId: result.locationId }),
      })
    );
  });

  it("updates campaign.currentNodeId for the initial node", async () => {
    const { campaigns, tx } = createTx();

    const result = await generateExplorationLocation(input(tx));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.currentNodeId).toBe(
      result.initialNodeId
    );
    expect(tx.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "campaign-1" },
        data: expect.objectContaining({ currentNodeId: result.initialNodeId }),
      })
    );
  });

  it("does not touch characters", async () => {
    const { characters, tx } = createTx();
    const before = structuredClone(characters);

    await generateExplorationLocation(input(tx));

    expect(characters).toEqual(before);
    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("does not touch inventory", async () => {
    const { inventory, tx } = createTx();
    const before = structuredClone(inventory);

    await generateExplorationLocation(input(tx));

    expect(inventory).toEqual(before);
    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  });

  it("does not touch combat", async () => {
    const { tx } = createTx();

    await generateExplorationLocation(input(tx));

    expect(tx.combatant.update).not.toHaveBeenCalled();
  });

  it("does not touch encounter", async () => {
    const { encounters, tx } = createTx();
    const before = structuredClone(encounters);

    await generateExplorationLocation(input(tx));

    expect(encounters).toEqual(before);
    expect(tx.encounter.update).not.toHaveBeenCalled();
  });

  it("does not touch quests", async () => {
    const { quests, tx } = createTx();
    const before = structuredClone(quests);

    await generateExplorationLocation(input(tx));

    expect(quests).toEqual(before);
    expect(tx.quest.create).not.toHaveBeenCalled();
    expect(tx.quest.update).not.toHaveBeenCalled();
  });

  it("does not touch economy", async () => {
    const { campaigns, tx } = createTx();

    await generateExplorationLocation(input(tx));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.gold).toBe(50);
    expect(campaigns.find((campaign) => campaign.id === "campaign-2")?.gold).toBe(75);
    expect(tx.trade.create).not.toHaveBeenCalled();
    expect(tx.trade.update).not.toHaveBeenCalled();
  });

  it("does not touch spell slots", async () => {
    const { characters, tx } = createTx();
    const before = structuredClone(characters.map((character) => character.spellSlots));

    await generateExplorationLocation(input(tx));

    expect(characters.map((character) => character.spellSlots)).toEqual(before);
  });

  it("does not touch rest state", async () => {
    const { campaignTime, partyInventory, tx } = createTx();
    const timeBefore = structuredClone(campaignTime);
    const inventoryBefore = structuredClone(partyInventory);

    await generateExplorationLocation(input(tx));

    expect(campaignTime).toEqual(timeBefore);
    expect(partyInventory).toEqual(inventoryBefore);
    expect(tx.campaignTime.update).not.toHaveBeenCalled();
    expect(tx.campaignTime.upsert).not.toHaveBeenCalled();
    expect(tx.partyInventory.update).not.toHaveBeenCalled();
    expect(tx.partyInventory.upsert).not.toHaveBeenCalled();
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await generateExplorationLocation(input(tx));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tx.ai.generateText).not.toHaveBeenCalled();
  });

  it("does not return long narrative prose", async () => {
    const { tx } = createTx();

    const result = await generateExplorationLocation(input(tx));

    expectNoNarrativeText(result);
    expect(JSON.stringify(result).length).toBeLessThan(3000);
  });

  it("returns structured facts", async () => {
    const { tx } = createTx();

    const result = await generateExplorationLocation(input(tx));

    expect(result).toMatchObject({
      ok: true,
      locationId: expect.any(String),
      initialNodeId: expect.any(String),
      nodeIds: expect.any(Array),
      edgeIds: expect.any(Array),
      facts: {
        type: "exploration_location_generated",
        campaignId: "campaign-1",
        locationId: expect.any(String),
        initialNodeId: expect.any(String),
        nodeIds: expect.any(Array),
        edgeIds: expect.any(Array),
        locationType: "dungeon",
      },
    });
  });

  it("uses a transaction when a db is injected instead of a tx", async () => {
    const state = createDb();
    const { db } = state;

    await generateExplorationLocation({
      campaignId: "campaign-1",
      userId: "user-1",
      locationType: "dungeon",
      seed: "seed-1",
      generatedContent: structuredClone(validGeneratedContent),
      db,
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("uses the injected tx without opening its own transaction", async () => {
    const state = createDb();

    await generateExplorationLocation(input(state.tx));

    expect(state.db.$transaction).not.toHaveBeenCalled();
  });

  it("does not create orphan nodes", async () => {
    const { locations, nodes, tx } = createTx();

    await generateExplorationLocation(input(tx));

    const locationIds = new Set(locations.map((location) => location.id));
    expect(nodes.every((node) => locationIds.has(node.locationId))).toBe(true);
  });

  it("does not create orphan edges", async () => {
    const { edges, nodes, tx } = createTx();

    await generateExplorationLocation(input(tx));

    const nodeIds = new Set(nodes.map((node) => node.id));
    expect(edges.every((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))).toBe(
      true
    );
  });

  it("rejects LocationNode payloads without a valid locationId path", async () => {
    const { tx } = createTx();
    const generatedContent = structuredClone(validGeneratedContent);
    generatedContent.nodes = [];

    await expect(
      generateExplorationLocation(input(tx, { generatedContent }))
    ).rejects.toMatchObject({ code: "INVALID_LOCATION_GRAPH" });

    expect(tx.locationNode.create).not.toHaveBeenCalled();
  });

  it("rejects LocationEdge payloads with invalid endpoints", async () => {
    const { tx } = createTx();
    const generatedContent = structuredClone(validGeneratedContent);
    generatedContent.edges = [{ fromIndex: 0, toIndex: 99, passageType: "open" }];

    await expect(
      generateExplorationLocation(input(tx, { generatedContent }))
    ).rejects.toMatchObject({ code: "INVALID_LOCATION_EDGE" });

    expect(tx.locationEdge.create).not.toHaveBeenCalled();
  });

  it("keeps compatibility with the structure currently returned by generateLocation", async () => {
    const { tx } = createTx();

    const result = await generateExplorationLocation(input(tx));

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        locationId: expect.any(String),
        name: expect.any(String),
        type: expect.any(String),
        seed: expect.any(String),
        nodeIds: expect.arrayContaining([result.initialNodeId]),
        edgeIds: expect.any(Array),
      })
    );
  });

  it("does not introduce forbidden retro rules or jargon", async () => {
    const { tx } = createTx();

    const result = await generateExplorationLocation(input(tx));

    expect(JSON.stringify(result)).not.toMatch(forbiddenRulePattern);
  });

  it("limits writes to location graph and campaign position", async () => {
    const { tx } = createTx();

    await generateExplorationLocation(input(tx));

    expect(tx.location.create).toHaveBeenCalled();
    expect(tx.locationNode.create).toHaveBeenCalled();
    expect(tx.locationEdge.create).toHaveBeenCalled();
    expect(tx.campaign.update).toHaveBeenCalled();
    expectNoUnrelatedWrites(tx);
  });
});
