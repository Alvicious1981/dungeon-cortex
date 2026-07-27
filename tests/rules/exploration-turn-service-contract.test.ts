import { describe, expect, it, vi } from "vitest";

type LightSource = "torch" | "lantern" | "none";
type TurnAction = "move" | "search" | "rest" | "interact" | "loud";

type CampaignFixture = {
  id: string;
  userId: string;
  characterId: string;
  status: "active" | "completed";
  currentLocationId: string | null;
  currentNodeId: string | null;
  gold: number;
};

type CharacterFixture = {
  id: string;
  campaignId: string;
  hp: number;
  maxHp: number;
  exhaustionLevel: number;
  spellSlots: Record<string, { current: number; max: number }> | null;
  questVersion: number;
  socialVersion: number;
  economyVersion: number;
  wildernessTravelState: Record<string, unknown>;
};

type CampaignTimeFixture = {
  campaignId: string;
  totalTurns: number;
  totalHours: number;
  totalDays: number;
  turnsSinceRest: number;
  turnsSinceEncounterCheck: number;
  turnsSinceRation: number;
};

type PartyInventoryFixture = {
  campaignId: string;
  torches: number;
  oilFlasks: number;
  rations: number;
  activeLightSource: LightSource;
  lightSourceTurnsRemaining: number;
  unrelatedInventoryVersion: number;
};

type EncounterFixture = {
  id: string;
  campaignId: string;
  status: "active" | "completed";
  combatResolved: boolean;
};

type LocationFixture = {
  id: string;
  campaignId: string;
};

type LocationNodeFixture = {
  id: string;
  locationId: string;
};

type LocationEdgeFixture = {
  id: string;
  locationId: string;
};

type ExplorationTurnTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  campaignTime: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  partyInventory: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  encounter: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  combatant: {
    update: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  quest: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  trade: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  social: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  location: {
    create: ReturnType<typeof vi.fn>;
  };
  locationNode: {
    create: ReturnType<typeof vi.fn>;
  };
  locationEdge: {
    create: ReturnType<typeof vi.fn>;
  };
  gameLog: {
    create: ReturnType<typeof vi.fn>;
  };
  ai: {
    generateText: ReturnType<typeof vi.fn>;
  };
};

type ExplorationTurnDb = ExplorationTurnTx & {
  $transaction: ReturnType<typeof vi.fn>;
};

type ResolveExplorationTurnInput = {
  campaignId: string;
  userId?: string;
  turnAction: TurnAction | string;
  turnsToAdvance?: number;
  randomEncounterRoll?: number;
  tx?: ExplorationTurnTx;
  db?: ExplorationTurnDb;
};

type ResolveExplorationTurn = (input: ResolveExplorationTurnInput) => Promise<unknown>;

const baseCampaigns: CampaignFixture[] = [
  {
    id: "campaign-1",
    userId: "user-1",
    characterId: "character-1",
    status: "active",
    currentLocationId: "location-1",
    currentNodeId: "node-1",
    gold: 25,
  },
  {
    id: "campaign-2",
    userId: "user-2",
    characterId: "character-2",
    status: "active",
    currentLocationId: "location-2",
    currentNodeId: "node-2",
    gold: 50,
  },
];

const baseCharacters: CharacterFixture[] = [
  {
    id: "character-1",
    campaignId: "campaign-1",
    hp: 10,
    maxHp: 10,
    exhaustionLevel: 0,
    spellSlots: { "1": { current: 1, max: 2 } },
    questVersion: 1,
    socialVersion: 1,
    economyVersion: 1,
    wildernessTravelState: { pace: "normal" },
  },
  {
    id: "character-2",
    campaignId: "campaign-2",
    hp: 8,
    maxHp: 8,
    exhaustionLevel: 0,
    spellSlots: { "1": { current: 1, max: 1 } },
    questVersion: 1,
    socialVersion: 1,
    economyVersion: 1,
    wildernessTravelState: { pace: "slow" },
  },
];

const baseCampaignTime: CampaignTimeFixture[] = [
  {
    campaignId: "campaign-1",
    totalTurns: 0,
    totalHours: 0,
    totalDays: 0,
    turnsSinceRest: 0,
    turnsSinceEncounterCheck: 0,
    turnsSinceRation: 0,
  },
];

const basePartyInventory: PartyInventoryFixture[] = [
  {
    campaignId: "campaign-1",
    torches: 2,
    oilFlasks: 1,
    rations: 4,
    activeLightSource: "torch",
    lightSourceTurnsRemaining: 3,
    unrelatedInventoryVersion: 1,
  },
];

const forbiddenRulePattern = new RegExp(
  [
    ["AD", "&", "D"].join(""),
    ["OS", "R"].join(""),
    ["TH", "AC", "0"].join(""),
    ["descending", "AC"].join(" "),
    ["AC", "descendente"].join(" "),
    ["saving", "throw", "vs"].join(" "),
    ["save", "vs", "death"].join(" "),
    ["save", "vs", "wands"].join(" "),
    ["gold", "for", "XP"].join(" "),
    ["XP", "por", "oro"].join(" "),
  ].join("|"),
  "i"
);

async function loadResolveExplorationTurn(): Promise<ResolveExplorationTurn> {
  const modulePath = "../../lib/rules/exploration-turn-service";
  const mod = await import(modulePath);
  return mod.resolveExplorationTurn as ResolveExplorationTurn;
}

function cloneCharacter(character: CharacterFixture): CharacterFixture {
  return {
    ...character,
    spellSlots: character.spellSlots ? structuredClone(character.spellSlots) : null,
    wildernessTravelState: structuredClone(character.wildernessTravelState),
  };
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  characters?: CharacterFixture[];
  campaignTime?: CampaignTimeFixture[];
  partyInventory?: PartyInventoryFixture[];
  encounters?: EncounterFixture[];
  locations?: LocationFixture[];
  nodes?: LocationNodeFixture[];
  edges?: LocationEdgeFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const characters = (options?.characters ?? baseCharacters).map(cloneCharacter);
  const campaignTime = (options?.campaignTime ?? baseCampaignTime).map((time) => ({
    ...time,
  }));
  const partyInventory = (options?.partyInventory ?? basePartyInventory).map((item) => ({
    ...item,
  }));
  const encounters = (options?.encounters ?? []).map((encounter) => ({ ...encounter }));
  const locations = (options?.locations ?? [{ id: "location-1", campaignId: "campaign-1" }]).map(
    (location) => ({ ...location })
  );
  const nodes = (options?.nodes ?? [{ id: "node-1", locationId: "location-1" }]).map((node) => ({
    ...node,
  }));
  const edges = (options?.edges ?? [{ id: "edge-1", locationId: "location-1" }]).map((edge) => ({
    ...edge,
  }));

  const tx: ExplorationTurnTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaigns.find((campaign) => campaign.id === where.id) ?? null
      ),
      update: vi.fn(),
    },
    character: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        characters.find((character) => character.id === where.id) ?? null
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<CharacterFixture> }) => {
          const character = characters.find((candidate) => candidate.id === where.id);
          if (!character) throw new Error(`Missing character ${where.id}`);
          const allowed = ["exhaustionLevel"];
          const keys = Object.keys(data);
          if (keys.some((key) => !allowed.includes(key))) {
            throw new Error(`Unexpected character update keys: ${keys.join(", ")}`);
          }
          if (data.exhaustionLevel !== undefined) {
            character.exhaustionLevel = data.exhaustionLevel;
          }
          return cloneCharacter(character);
        }
      ),
    },
    campaignTime: {
      findUnique: vi.fn(async ({ where }: { where: { campaignId: string } }) =>
        campaignTime.find((time) => time.campaignId === where.campaignId) ?? null
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { campaignId: string };
          create: CampaignTimeFixture;
          update: Partial<CampaignTimeFixture>;
        }) => {
          const existing = campaignTime.find((time) => time.campaignId === where.campaignId);
          if (!existing) {
            campaignTime.push({ ...create });
            return { ...create };
          }
          Object.assign(existing, update);
          return { ...existing };
        }
      ),
      update: vi.fn(),
    },
    partyInventory: {
      findUnique: vi.fn(async ({ where }: { where: { campaignId: string } }) =>
        partyInventory.find((item) => item.campaignId === where.campaignId) ?? null
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { campaignId: string };
          create: PartyInventoryFixture;
          update: Partial<PartyInventoryFixture>;
        }) => {
          const existing = partyInventory.find((item) => item.campaignId === where.campaignId);
          if (!existing) {
            partyInventory.push({ ...create });
            return { ...create };
          }
          const keys = Object.keys(update);
          const allowed = [
            "torches",
            "oilFlasks",
            "rations",
            "activeLightSource",
            "lightSourceTurnsRemaining",
          ];
          if (keys.some((key) => !allowed.includes(key))) {
            throw new Error(`Unexpected partyInventory update keys: ${keys.join(", ")}`);
          }
          Object.assign(existing, update);
          return { ...existing };
        }
      ),
      update: vi.fn(),
    },
    encounter: {
      findFirst: vi.fn(async ({ where }: { where: { campaignId: string; status: string } }) =>
        encounters.find(
          (encounter) =>
            encounter.campaignId === where.campaignId && encounter.status === where.status
        ) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Omit<EncounterFixture, "id"> }) => {
        const encounter = { id: `encounter-${encounters.length + 1}`, ...data };
        encounters.push(encounter);
        return { ...encounter };
      }),
      update: vi.fn(),
    },
    combatant: { update: vi.fn() },
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    quest: {
      create: vi.fn(),
      update: vi.fn(),
    },
    trade: {
      create: vi.fn(),
      update: vi.fn(),
    },
    social: {
      create: vi.fn(),
      update: vi.fn(),
    },
    location: {
      create: vi.fn(async ({ data }: { data: LocationFixture }) => {
        locations.push({ ...data });
        return { ...data };
      }),
    },
    locationNode: {
      create: vi.fn(async ({ data }: { data: LocationNodeFixture }) => {
        nodes.push({ ...data });
        return { ...data };
      }),
    },
    locationEdge: {
      create: vi.fn(async ({ data }: { data: LocationEdgeFixture }) => {
        edges.push({ ...data });
        return { ...data };
      }),
    },
    gameLog: {
      create: vi.fn(),
    },
    ai: {
      generateText: vi.fn(),
    },
  };

  return {
    campaigns,
    characters,
    campaignTime,
    partyInventory,
    encounters,
    locations,
    nodes,
    edges,
    tx,
  };
}

function createDb(state = createTx()): ReturnType<typeof createTx> & { db: ExplorationTurnDb } {
  const db = {
    ...state.tx,
    $transaction: vi.fn(async (fn: (tx: ExplorationTurnTx) => Promise<unknown>) =>
      fn(state.tx)
    ),
  };

  return { ...state, db };
}

async function resolveTurn(
  overrides?: Partial<ResolveExplorationTurnInput>,
  state = createTx()
): Promise<unknown> {
  const resolveExplorationTurn = await loadResolveExplorationTurn();
  return resolveExplorationTurn({
    campaignId: "campaign-1",
    userId: "user-1",
    turnAction: "move",
    turnsToAdvance: 1,
    randomEncounterRoll: 6,
    tx: state.tx,
    ...overrides,
  });
}

function expectNoCrossDomainWrites(tx: ExplorationTurnTx) {
  expect(tx.combatant.update).not.toHaveBeenCalled();
  expect(tx.inventoryItem.create).not.toHaveBeenCalled();
  expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
  expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  expect(tx.quest.create).not.toHaveBeenCalled();
  expect(tx.quest.update).not.toHaveBeenCalled();
  expect(tx.trade.create).not.toHaveBeenCalled();
  expect(tx.trade.update).not.toHaveBeenCalled();
  expect(tx.social.create).not.toHaveBeenCalled();
  expect(tx.social.update).not.toHaveBeenCalled();
  expect(tx.location.create).not.toHaveBeenCalled();
  expect(tx.locationNode.create).not.toHaveBeenCalled();
  expect(tx.locationEdge.create).not.toHaveBeenCalled();
}

describe("exploration-turn-service resolveExplorationTurn contract", () => {
  it("rejects a missing campaign", async () => {
    const state = createTx({ campaigns: [] });

    await expect(resolveTurn({}, state)).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });
  });

  it("rejects a campaign that does not belong to the actor", async () => {
    const state = createTx();

    await expect(resolveTurn({ userId: "user-2" }, state)).rejects.toMatchObject({
      code: "CAMPAIGN_OWNERSHIP_MISMATCH",
    });
  });

  it("rejects invalid input", async () => {
    const state = createTx();

    await expect(resolveTurn({ turnAction: "invalid-action" }, state)).rejects.toMatchObject({
      code: "INVALID_EXPLORATION_TURN_INPUT",
    });
  });

  it("advances time using the current exploration-turn semantics", async () => {
    const state = createTx();

    const result = await resolveTurn({ turnsToAdvance: 2 }, state);

    expect(state.campaignTime.find((time) => time.campaignId === "campaign-1")).toMatchObject({
      totalTurns: 2,
      totalHours: 0,
      totalDays: 0,
      turnsSinceRest: 2,
      turnsSinceEncounterCheck: 0,
      turnsSinceRation: 2,
    });
    expect(result).toMatchObject({
      ok: true,
      campaignTime: expect.objectContaining({ totalTurns: 2 }),
      facts: expect.objectContaining({ turnsAdvanced: 2 }),
    });
  });

  it("consumes resources according to current semantics", async () => {
    const state = createTx({
      partyInventory: [
        {
          ...basePartyInventory[0],
          activeLightSource: "torch",
          lightSourceTurnsRemaining: 1,
        },
      ],
    });

    const result = await resolveTurn({}, state);

    expect(state.partyInventory[0]).toMatchObject({
      torches: 1,
      activeLightSource: "torch",
      lightSourceTurnsRemaining: 6,
    });
    expect(result).toMatchObject({
      resourceChanges: expect.objectContaining({
        lightExpired: true,
      }),
    });
  });

  it("does not consume resources when rest resets only the rest cycle", async () => {
    const state = createTx();
    const before = structuredClone(state.partyInventory);

    await resolveTurn({ turnAction: "rest" }, state);

    expect(state.partyInventory).toEqual(before);
  });

  it("updates inventory only in exploration resource fields", async () => {
    const state = createTx();

    await resolveTurn({}, state);

    const updateData = state.tx.partyInventory.upsert.mock.calls[0]?.[0]?.update ?? {};
    expect(Object.keys(updateData).sort()).toEqual(
      ["activeLightSource", "lightSourceTurnsRemaining", "oilFlasks", "rations", "torches"].sort()
    );
  });

  it("does not apply exhaustion from a legacy rest counter", async () => {
    const state = createTx({
      campaignTime: [{ ...baseCampaignTime[0], turnsSinceRest: 6 }],
    });

    await resolveTurn({}, state);

    expect(state.characters.find((character) => character.id === "character-1")?.exhaustionLevel).toBe(
      0
    );
  });

  it("does not mutate a terminal exhaustion value during exploration", async () => {
    const state = createTx({
      characters: [{ ...baseCharacters[0], exhaustionLevel: 6 }],
      campaignTime: [{ ...baseCampaignTime[0], turnsSinceRest: 6 }],
    });

    await expect(resolveTurn({}, state)).resolves.toMatchObject({ exhaustionApplied: false });
    expect(state.characters.find((character) => character.id === "character-1")?.exhaustionLevel).toBe(6);
  });

  it("can resolve a rest turn using only the existing exploration rest-cycle semantics", async () => {
    const state = createTx({
      campaignTime: [{ ...baseCampaignTime[0], turnsSinceRest: 5 }],
    });

    const result = await resolveTurn({ turnAction: "rest" }, state);

    expect(state.campaignTime[0].turnsSinceRest).toBe(0);
    expect(result).toMatchObject({
      ok: true,
      action: "rest",
      restRequired: false,
    });
  });

  it("does not duplicate character rest recovery from rest-service during exploration rest", async () => {
    const state = createTx();
    const before = state.characters.map(cloneCharacter);

    await resolveTurn({ turnAction: "rest" }, state);

    expect(state.characters).toEqual(before);
    expect(state.tx.character.update).not.toHaveBeenCalled();
  });

  it("checks random encounters deterministically in tests", async () => {
    const state = createTx({
      campaignTime: [{ ...baseCampaignTime[0], turnsSinceEncounterCheck: 1 }],
    });

    const result = await resolveTurn({ randomEncounterRoll: 6 }, state);

    expect(result).toMatchObject({
      randomEncounter: {
        triggered: false,
        roll: 6,
      },
    });
  });

  it("does not create an encounter when no random encounter triggers", async () => {
    const state = createTx({
      campaignTime: [{ ...baseCampaignTime[0], turnsSinceEncounterCheck: 1 }],
    });

    await resolveTurn({ randomEncounterRoll: 6 }, state);

    expect(state.tx.encounter.create).not.toHaveBeenCalled();
  });

  it("returns encounter facts without resolving combat when an encounter triggers", async () => {
    const state = createTx({
      campaignTime: [{ ...baseCampaignTime[0], turnsSinceEncounterCheck: 1 }],
    });

    const result = await resolveTurn({ randomEncounterRoll: 1 }, state);

    expect(result).toMatchObject({
      randomEncounter: {
        triggered: true,
        roll: 1,
      },
      facts: expect.objectContaining({
        encounter: expect.objectContaining({
          triggered: true,
        }),
      }),
    });
    expect(state.tx.combatant.update).not.toHaveBeenCalled();
  });

  it("does not modify characters except exploration-related exhaustion", async () => {
    const state = createTx();
    const before = state.characters.map(cloneCharacter);

    await resolveTurn({}, state);

    expect(state.characters).toEqual(before);
    expect(state.tx.character.update).not.toHaveBeenCalled();
  });

  it("does not modify spell slots", async () => {
    const state = createTx();
    const before = state.characters.map((character) => structuredClone(character.spellSlots));

    await resolveTurn({}, state);

    expect(state.characters.map((character) => character.spellSlots)).toEqual(before);
  });

  it("does not modify quests", async () => {
    const state = createTx();

    await resolveTurn({}, state);

    expect(state.tx.quest.create).not.toHaveBeenCalled();
    expect(state.tx.quest.update).not.toHaveBeenCalled();
  });

  it("does not modify economy", async () => {
    const state = createTx();
    const goldBefore = state.campaigns.map((campaign) => campaign.gold);

    await resolveTurn({}, state);

    expect(state.campaigns.map((campaign) => campaign.gold)).toEqual(goldBefore);
    expect(state.tx.trade.create).not.toHaveBeenCalled();
    expect(state.tx.trade.update).not.toHaveBeenCalled();
  });

  it("does not modify social state", async () => {
    const state = createTx();
    const before = state.characters.map((character) => character.socialVersion);

    await resolveTurn({}, state);

    expect(state.characters.map((character) => character.socialVersion)).toEqual(before);
    expect(state.tx.social.create).not.toHaveBeenCalled();
    expect(state.tx.social.update).not.toHaveBeenCalled();
  });

  it("does not modify the navigation graph", async () => {
    const state = createTx();
    const before = {
      campaigns: state.campaigns.map((campaign) => ({
        currentLocationId: campaign.currentLocationId,
        currentNodeId: campaign.currentNodeId,
      })),
      locations: structuredClone(state.locations),
      nodes: structuredClone(state.nodes),
      edges: structuredClone(state.edges),
    };

    await resolveTurn({}, state);

    expect(state.campaigns.map((campaign) => ({
      currentLocationId: campaign.currentLocationId,
      currentNodeId: campaign.currentNodeId,
    }))).toEqual(before.campaigns);
    expect(state.locations).toEqual(before.locations);
    expect(state.nodes).toEqual(before.nodes);
    expect(state.edges).toEqual(before.edges);
  });

  it("does not create Location, LocationNode, or LocationEdge", async () => {
    const state = createTx();

    await resolveTurn({}, state);

    expect(state.tx.location.create).not.toHaveBeenCalled();
    expect(state.tx.locationNode.create).not.toHaveBeenCalled();
    expect(state.tx.locationEdge.create).not.toHaveBeenCalled();
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const state = createTx();

    await resolveTurn({}, state);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.tx.ai.generateText).not.toHaveBeenCalled();
  });

  it("does not return long narrative prose", async () => {
    const state = createTx();

    const result = await resolveTurn({}, state);

    expect(JSON.stringify(result)).not.toMatch(
      /\b(narration|narrative|prose|flavorText|boxed text|you advance|you move)\b/i
    );
    expect(JSON.stringify(result).length).toBeLessThan(2500);
  });

  it("returns structured facts", async () => {
    const state = createTx();

    const result = await resolveTurn({}, state);

    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "exploration_turn_resolved",
        campaignId: "campaign-1",
        action: "move",
        turnsAdvanced: 1,
      },
    });
  });

  it("uses a transaction when a db is injected instead of a tx", async () => {
    const state = createDb();
    const resolveExplorationTurn = await loadResolveExplorationTurn();

    await resolveExplorationTurn({
      campaignId: "campaign-1",
      userId: "user-1",
      turnAction: "move",
      turnsToAdvance: 1,
      randomEncounterRoll: 6,
      db: state.db,
    });

    expect(state.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("uses the injected tx without opening its own transaction", async () => {
    const state = createDb();

    await resolveTurn({ tx: state.tx }, state);

    expect(state.db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps compatibility with the current executeExplorationTurn response shape", async () => {
    const state = createTx();

    const result = await resolveTurn({}, state);

    expect(result).toEqual(
      expect.objectContaining({
        action: "move",
        turnsAdvanced: expect.any(Number),
        totalTurns: expect.any(Number),
        totalHours: expect.any(Number),
        restRequired: expect.any(Boolean),
        encounter: null,
        lightSource: expect.any(String),
        lightSourceTurnsLeft: expect.any(Number),
        lightExpired: expect.any(Boolean),
        rationsDepleted: expect.any(Boolean),
        warnings: expect.any(Array),
      })
    );
  });

  it("does not introduce forbidden retro rules or jargon", async () => {
    const state = createTx();

    const result = await resolveTurn({}, state);

    expect(JSON.stringify(result)).not.toMatch(forbiddenRulePattern);
  });

  it("does not touch combat pipeline or resolve attacks", async () => {
    const state = createTx();

    await resolveTurn({ randomEncounterRoll: 1 }, state);

    expect(state.tx.combatant.update).not.toHaveBeenCalled();
    expect(state.tx.encounter.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) })
    );
  });

  it("does not finalize encounters", async () => {
    const state = createTx({
      encounters: [{ id: "encounter-1", campaignId: "campaign-1", status: "active", combatResolved: false }],
    });

    await resolveTurn({}, state);

    expect(state.encounters[0]).toMatchObject({
      status: "active",
      combatResolved: false,
    });
  });

  it("does not touch wilderness travel state", async () => {
    const state = createTx();
    const before = state.characters.map((character) =>
      structuredClone(character.wildernessTravelState)
    );

    await resolveTurn({}, state);

    expect(state.characters.map((character) => character.wildernessTravelState)).toEqual(before);
  });

  it("keeps exploration turns scoped away from unrelated domains", async () => {
    const state = createTx();

    await resolveTurn({}, state);

    expectNoCrossDomainWrites(state.tx);
  });
});

