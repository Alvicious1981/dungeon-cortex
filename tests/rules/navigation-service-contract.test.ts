import { beforeEach, describe, expect, it, vi } from "vitest";

type CampaignFixture = {
  id: string;
  characterId: string;
  currentLocationId: string | null;
  currentNodeId: string | null;
  gold: number;
};

type LocationFixture = {
  id: string;
  campaignId: string;
  name: string;
};

type LocationNodeFixture = {
  id: string;
  locationId: string;
  index: number;
  name: string;
  description: string;
  feature: string;
};

type LocationEdgeFixture = {
  id: string;
  locationId: string;
  fromNodeId: string;
  toNodeId: string;
  passageType: string;
};

type InventoryItemFixture = {
  id: string;
  campaignId: string;
  characterId: string;
  name: string;
  quantity: number;
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

type NavigationTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  location: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  locationNode: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  locationEdge: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  encounter: {
    update: ReturnType<typeof vi.fn>;
  };
  quest: {
    update: ReturnType<typeof vi.fn>;
  };
};

type MoveCampaignToNodeInput = {
  campaignId: string;
  fromNodeId?: string;
  toNodeId: string;
  characterId?: string;
  tx: NavigationTx;
};

type NavigationServiceResult = {
  ok?: boolean;
  campaignId?: string;
  fromNodeId?: string;
  toNodeId?: string;
  locationId?: string;
  passageType?: string;
  facts?: unknown;
  narrative?: unknown;
  text?: unknown;
  prose?: unknown;
  message?: unknown;
};

type MoveCampaignToNode = (
  input: MoveCampaignToNodeInput
) => Promise<NavigationServiceResult>;

const baseCampaigns: CampaignFixture[] = [
  {
    id: "campaign-1",
    characterId: "character-1",
    currentLocationId: "location-1",
    currentNodeId: "node-1",
    gold: 100,
  },
  {
    id: "campaign-2",
    characterId: "character-2",
    currentLocationId: "location-2",
    currentNodeId: "node-4",
    gold: 250,
  },
];

const baseLocations: LocationFixture[] = [
  { id: "location-1", campaignId: "campaign-1", name: "Old Cellar" },
  { id: "location-2", campaignId: "campaign-2", name: "Other Cellar" },
];

const baseNodes: LocationNodeFixture[] = [
  {
    id: "node-1",
    locationId: "location-1",
    index: 0,
    name: "Entry",
    description: "The entry chamber.",
    feature: "empty",
  },
  {
    id: "node-2",
    locationId: "location-1",
    index: 1,
    name: "Gallery",
    description: "A narrow gallery.",
    feature: "empty",
  },
  {
    id: "node-3",
    locationId: "location-1",
    index: 2,
    name: "Vault",
    description: "A sealed vault.",
    feature: "treasure",
  },
  {
    id: "node-4",
    locationId: "location-2",
    index: 0,
    name: "Other Entry",
    description: "Another entry.",
    feature: "empty",
  },
];

const baseEdges: LocationEdgeFixture[] = [
  {
    id: "edge-1",
    locationId: "location-1",
    fromNodeId: "node-1",
    toNodeId: "node-2",
    passageType: "open",
  },
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

const baseEncounters: EncounterFixture[] = [
  { id: "encounter-1", campaignId: "campaign-1", status: "active" },
];

const baseQuests: QuestFixture[] = [
  { id: "quest-1", campaignId: "campaign-1", status: "active" },
];

const forbiddenRulePattern = new RegExp(
  [
    ["AD", "&", "D"].join(""),
    ["OS", "R"].join(""),
    ["TH", "AC", "0"].join(""),
    "descending AC",
    "AC descendente",
    "saving throw vs",
    "save vs death",
    "gold for XP",
    "XP por oro",
  ].join("|"),
  "i"
);

async function loadNavigationService(): Promise<MoveCampaignToNode> {
  const modulePath = "../../lib/rules/navigation-service";
  const mod = await import(modulePath);
  return mod.moveCampaignToNode as MoveCampaignToNode;
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  locations?: LocationFixture[];
  nodes?: LocationNodeFixture[];
  edges?: LocationEdgeFixture[];
  inventory?: InventoryItemFixture[];
  encounters?: EncounterFixture[];
  quests?: QuestFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const locations = (options?.locations ?? baseLocations).map((location) => ({
    ...location,
  }));
  const nodes = (options?.nodes ?? baseNodes).map((node) => ({ ...node }));
  const edges = (options?.edges ?? baseEdges).map((edge) => ({ ...edge }));
  const inventory = (options?.inventory ?? baseInventory).map((item) => ({ ...item }));
  const encounters = (options?.encounters ?? baseEncounters).map((encounter) => ({
    ...encounter,
  }));
  const quests = (options?.quests ?? baseQuests).map((quest) => ({ ...quest }));

  const tx: NavigationTx = {
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
          data: Partial<Pick<CampaignFixture, "currentNodeId">>;
        }) => {
          const campaign = campaigns.find((candidate) => candidate.id === where.id);
          if (!campaign) throw new Error(`Missing campaign ${where.id}`);
          if (data.currentNodeId !== undefined) campaign.currentNodeId = data.currentNodeId;
          return { ...campaign };
        }
      ),
    },
    location: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        locations.find((location) => location.id === where.id) ?? null
      ),
      create: vi.fn(),
    },
    locationNode: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        nodes.find((node) => node.id === where.id) ?? null
      ),
      create: vi.fn(),
      update: vi.fn(),
    },
    locationEdge: {
      findMany: vi.fn(async ({ where }: { where: { locationId: string } }) =>
        edges.filter((edge) => edge.locationId === where.locationId)
      ),
      create: vi.fn(),
    },
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
    },
    encounter: {
      update: vi.fn(),
    },
    quest: {
      update: vi.fn(),
    },
  };

  return { campaigns, locations, nodes, edges, inventory, encounters, quests, tx };
}

function input(
  tx: NavigationTx,
  overrides?: Partial<MoveCampaignToNodeInput>
): MoveCampaignToNodeInput {
  return {
    campaignId: "campaign-1",
    toNodeId: "node-2",
    tx,
    ...overrides,
  };
}

function expectStructuredFacts(result: NavigationServiceResult) {
  expect(result).toMatchObject({ ok: true });
  expect(result.facts ?? result).toEqual(expect.any(Object));
}

function expectNoNarrativeText(result: NavigationServiceResult) {
  expect(result.narrative).toBeUndefined();
  expect(result.text).toBeUndefined();
  expect(result.prose).toBeUndefined();
  expect(result.message).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(
    /\b(narration|narrative|prose|flavorText|boxed text|you enter|you arrive)\b/i
  );
}

describe("navigation-service moveCampaignToNode contract", () => {
  let moveCampaignToNode: MoveCampaignToNode;

  beforeEach(async () => {
    moveCampaignToNode = await loadNavigationService();
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaigns: [] });

    await expect(moveCampaignToNode(input(tx))).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });

    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects a missing destination node", async () => {
    const { tx } = createTx({ nodes: baseNodes.filter((node) => node.id !== "node-2") });

    await expect(moveCampaignToNode(input(tx))).rejects.toMatchObject({
      code: "DESTINATION_NODE_NOT_FOUND",
    });

    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects a destination node from another location or campaign", async () => {
    const { tx } = createTx();

    await expect(moveCampaignToNode(input(tx, { toNodeId: "node-4" }))).rejects.toMatchObject({
      code: "DESTINATION_LOCATION_MISMATCH",
    });

    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects movement when the campaign has no valid currentNodeId", async () => {
    const { tx } = createTx({
      campaigns: [
        {
          id: "campaign-1",
          characterId: "character-1",
          currentLocationId: "location-1",
          currentNodeId: "missing-node",
          gold: 100,
        },
      ],
    });

    await expect(moveCampaignToNode(input(tx))).rejects.toMatchObject({
      code: "CURRENT_NODE_NOT_FOUND",
    });

    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects movement when the current and destination nodes are not connected", async () => {
    const { tx } = createTx();

    await expect(moveCampaignToNode(input(tx, { toNodeId: "node-3" }))).rejects.toMatchObject({
      code: "NODES_NOT_CONNECTED",
    });

    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it("allows valid movement between connected nodes", async () => {
    const { tx } = createTx();

    const result = await moveCampaignToNode(input(tx));

    expect(result).toMatchObject({
      ok: true,
      campaignId: "campaign-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      locationId: "location-1",
      passageType: "open",
    });
  });

  it("updates campaign.currentNodeId for valid movement", async () => {
    const { campaigns, tx } = createTx();

    await moveCampaignToNode(input(tx));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.currentNodeId).toBe("node-2");
    expect(tx.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "campaign-1" },
        data: expect.objectContaining({ currentNodeId: "node-2" }),
      })
    );
  });

  it("does not touch another campaign", async () => {
    const { campaigns, tx } = createTx();

    await moveCampaignToNode(input(tx));

    expect(campaigns.find((campaign) => campaign.id === "campaign-2")).toMatchObject({
      currentLocationId: "location-2",
      currentNodeId: "node-4",
      gold: 250,
    });
  });

  it("does not touch another location", async () => {
    const { locations, tx } = createTx();

    await moveCampaignToNode(input(tx));

    expect(locations.find((location) => location.id === "location-2")).toEqual({
      id: "location-2",
      campaignId: "campaign-2",
      name: "Other Cellar",
    });
    expect(tx.location.create).not.toHaveBeenCalled();
  });

  it("does not touch unrelated nodes", async () => {
    const { nodes, tx } = createTx();
    const unrelatedBefore = { ...nodes.find((node) => node.id === "node-3")! };

    await moveCampaignToNode(input(tx));

    expect(nodes.find((node) => node.id === "node-3")).toEqual(unrelatedBefore);
    expect(tx.locationNode.update).not.toHaveBeenCalled();
  });

  it("does not modify inventory", async () => {
    const { inventory, tx } = createTx();
    const inventoryBefore = inventory.map((item) => ({ ...item }));

    await moveCampaignToNode(input(tx));

    expect(inventory).toEqual(inventoryBefore);
    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it("does not modify combat", async () => {
    const { encounters, tx } = createTx();
    const encountersBefore = encounters.map((encounter) => ({ ...encounter }));

    await moveCampaignToNode(input(tx));

    expect(encounters).toEqual(encountersBefore);
    expect(tx.encounter.update).not.toHaveBeenCalled();
  });

  it("does not modify quests", async () => {
    const { quests, tx } = createTx();
    const questsBefore = quests.map((quest) => ({ ...quest }));

    await moveCampaignToNode(input(tx));

    expect(quests).toEqual(questsBefore);
    expect(tx.quest.update).not.toHaveBeenCalled();
  });

  it("does not modify economy", async () => {
    const { campaigns, tx } = createTx();

    await moveCampaignToNode(input(tx));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.gold).toBe(100);
    expect(campaigns.find((campaign) => campaign.id === "campaign-2")?.gold).toBe(250);
  });

  it("returns structured facts for narration and UI", async () => {
    const { tx } = createTx();

    const result = await moveCampaignToNode(input(tx));

    expectStructuredFacts(result);
    expect(result.facts ?? result).toEqual(
      expect.objectContaining({
        type: "campaign_node_moved",
        campaignId: "campaign-1",
        fromNodeId: "node-1",
        toNodeId: "node-2",
        locationId: "location-1",
      })
    );
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();

    const result = await moveCampaignToNode(input(tx));

    expectNoNarrativeText(result);
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await moveCampaignToNode(input(tx));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not introduce forbidden retro rules or jargon", async () => {
    const { tx } = createTx();

    const result = await moveCampaignToNode(input(tx));

    expect(JSON.stringify(result)).not.toMatch(forbiddenRulePattern);
  });

  it("does not create locations or nodes", async () => {
    const { locations, nodes, tx } = createTx();
    const locationCount = locations.length;
    const nodeCount = nodes.length;

    await moveCampaignToNode(input(tx));

    expect(locations).toHaveLength(locationCount);
    expect(nodes).toHaveLength(nodeCount);
    expect(tx.location.create).not.toHaveBeenCalled();
    expect(tx.locationNode.create).not.toHaveBeenCalled();
  });

  it("does not execute procedural generation", async () => {
    const { tx } = createTx();

    await moveCampaignToNode(input(tx));

    expect(tx.location.create).not.toHaveBeenCalled();
    expect(tx.locationNode.create).not.toHaveBeenCalled();
    expect(tx.locationEdge.create).not.toHaveBeenCalled();
  });
});
