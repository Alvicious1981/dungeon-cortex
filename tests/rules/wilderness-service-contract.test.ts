import { describe, expect, it, vi } from "vitest";

type TravelAction = "travel" | "forage" | "rest" | "camp" | "scout";
type TravelPace = "slow" | "normal" | "fast";
type TerrainType =
  | "plains"
  | "forest"
  | "hills"
  | "mountain"
  | "swamp"
  | "desert"
  | "coast"
  | "tundra"
  | "taiga";
type WeatherCondition = "clear" | "overcast" | "rain" | "storm" | "fog" | "snow";
type WeatherIntensity = 0 | 1 | 2;

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
  stats: Record<string, number>;
  hp: number;
  maxHp: number;
  spellSlots: Record<string, { current: number; max: number }> | null;
  exhaustionLevel: number;
  questVersion: number;
  socialVersion: number;
  restStateVersion: number;
  downtimeVersion: number;
};

type TravelStateFixture = {
  id: string;
  campaignId: string;
  currentQ: number;
  currentR: number;
  currentWatch: number;
  totalWatches: number;
  totalDays: number;
  watchesTraveledToday: number;
  watchesSinceRation: number;
  weatherWatchCounter: number;
  partialHexProgress: number;
  partyPace: TravelPace;
  weatherCondition: WeatherCondition;
  weatherIntensity: WeatherIntensity;
  seasonIndex: number;
};

type WildernessHexFixture = {
  id: string;
  campaignId: string;
  q: number;
  r: number;
  terrain: TerrainType;
  biome: string;
  elevation: number;
  moisture: number;
  discovered: boolean;
  scouted: boolean;
  seed: string;
};

type PartyInventoryFixture = {
  campaignId: string;
  rations: number;
  torches: number;
  oilFlasks: number;
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

type WildernessTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  travelState: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  wildernessMap: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  partyInventory: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  encounter: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  combatant: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
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
  restState: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  navigationNode: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  navigationEdge: {
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

type WildernessDb = WildernessTx & {
  $transaction: ReturnType<typeof vi.fn>;
};

type ResolveTravelWatchInput = {
  campaignId: string;
  userId?: string;
  watchAction?: TravelAction | string;
  actionType?: TravelAction | string;
  action?: TravelAction | string;
  direction?: number;
  pace?: TravelPace;
  travelStateId?: string;
  hexId?: string;
  weatherRoll?: number;
  encounterRoll?: number;
  foragingRoll?: number;
  foragingYieldRoll?: number;
  scoutingRoll?: number;
  tx?: WildernessTx;
  db?: WildernessDb;
};

type ResolveTravelWatch = (input: ResolveTravelWatchInput) => Promise<unknown>;

const baseCampaigns: CampaignFixture[] = [
  {
    id: "campaign-1",
    userId: "user-1",
    characterId: "character-1",
    status: "active",
    currentLocationId: null,
    currentNodeId: null,
    gold: 25,
  },
  {
    id: "campaign-2",
    userId: "user-2",
    characterId: "character-2",
    status: "active",
    currentLocationId: null,
    currentNodeId: null,
    gold: 50,
  },
];

const baseCharacters: CharacterFixture[] = [
  {
    id: "character-1",
    campaignId: "campaign-1",
    stats: { WIS: 14, STR: 10, DEX: 10, CON: 10, INT: 10, CHA: 10 },
    hp: 12,
    maxHp: 12,
    spellSlots: { "1": { current: 2, max: 2 } },
    exhaustionLevel: 0,
    questVersion: 1,
    socialVersion: 1,
    restStateVersion: 1,
    downtimeVersion: 1,
  },
  {
    id: "character-2",
    campaignId: "campaign-2",
    stats: { WIS: 10 },
    hp: 8,
    maxHp: 8,
    spellSlots: { "1": { current: 1, max: 1 } },
    exhaustionLevel: 0,
    questVersion: 1,
    socialVersion: 1,
    restStateVersion: 1,
    downtimeVersion: 1,
  },
];

const baseTravelStates: TravelStateFixture[] = [
  {
    id: "travel-state-1",
    campaignId: "campaign-1",
    currentQ: 0,
    currentR: 0,
    currentWatch: 0,
    totalWatches: 0,
    totalDays: 0,
    watchesTraveledToday: 0,
    watchesSinceRation: 0,
    weatherWatchCounter: 0,
    partialHexProgress: 0,
    partyPace: "normal",
    weatherCondition: "clear",
    weatherIntensity: 0,
    seasonIndex: 0,
  },
];

const baseWildernessHexes: WildernessHexFixture[] = [
  {
    id: "hex-origin",
    campaignId: "campaign-1",
    q: 0,
    r: 0,
    terrain: "plains",
    biome: "temperate grassland",
    elevation: 20,
    moisture: 40,
    discovered: true,
    scouted: true,
    seed: "campaign-1:0:0",
  },
];

const basePartyInventory: PartyInventoryFixture[] = [
  {
    campaignId: "campaign-1",
    rations: 4,
    torches: 2,
    oilFlasks: 1,
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

async function loadResolveTravelWatch(): Promise<ResolveTravelWatch> {
  const modulePath = "../../lib/rules/wilderness-service";
  const mod = await import(modulePath);
  return mod.resolveTravelWatch as ResolveTravelWatch;
}

function cloneCharacter(character: CharacterFixture): CharacterFixture {
  return {
    ...character,
    stats: { ...character.stats },
    spellSlots: character.spellSlots ? structuredClone(character.spellSlots) : null,
  };
}

function cloneTravelState(state: TravelStateFixture): TravelStateFixture {
  return { ...state };
}

function cloneHex(hex: WildernessHexFixture): WildernessHexFixture {
  return { ...hex };
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  characters?: CharacterFixture[];
  travelStates?: TravelStateFixture[];
  wildernessHexes?: WildernessHexFixture[];
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
  const travelStates = (options?.travelStates ?? baseTravelStates).map(cloneTravelState);
  const wildernessHexes = (options?.wildernessHexes ?? baseWildernessHexes).map(cloneHex);
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

  const tx: WildernessTx = {
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
          const keys = Object.keys(data);
          if (keys.length > 0) {
            throw new Error(`Unexpected character update keys: ${keys.join(", ")}`);
          }
          return cloneCharacter(character);
        }
      ),
    },
    travelState: {
      findUnique: vi.fn(async ({ where }: { where: { campaignId?: string; id?: string } }) =>
        travelStates.find(
          (state) =>
            (where.campaignId !== undefined && state.campaignId === where.campaignId) ||
            (where.id !== undefined && state.id === where.id)
        ) ?? null
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { campaignId: string };
          create: TravelStateFixture;
          update: Partial<TravelStateFixture>;
        }) => {
          const existing = travelStates.find((state) => state.campaignId === where.campaignId);
          if (!existing) {
            const created = { ...create, id: create.id || `travel-state-${travelStates.length + 1}` };
            travelStates.push(created);
            return cloneTravelState(created);
          }
          Object.assign(existing, update);
          return cloneTravelState(existing);
        }
      ),
      update: vi.fn(),
      create: vi.fn(),
    },
    wildernessMap: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where:
            | { id: string }
            | { campaignId_q_r: { campaignId: string; q: number; r: number } };
        }) => {
          if ("id" in where) {
            return wildernessHexes.find((hex) => hex.id === where.id) ?? null;
          }
          return (
            wildernessHexes.find(
              (hex) =>
                hex.campaignId === where.campaignId_q_r.campaignId &&
                hex.q === where.campaignId_q_r.q &&
                hex.r === where.campaignId_q_r.r
            ) ?? null
          );
        }
      ),
      findMany: vi.fn(async ({ where }: { where: { campaignId: string } }) =>
        wildernessHexes.filter((hex) => hex.campaignId === where.campaignId)
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { campaignId_q_r: { campaignId: string; q: number; r: number } };
          create: Omit<WildernessHexFixture, "id"> & { id?: string };
          update: Partial<WildernessHexFixture>;
        }) => {
          const existing = wildernessHexes.find(
            (hex) =>
              hex.campaignId === where.campaignId_q_r.campaignId &&
              hex.q === where.campaignId_q_r.q &&
              hex.r === where.campaignId_q_r.r
          );
          if (!existing) {
            const created = {
              id: create.id ?? `hex-${wildernessHexes.length + 1}`,
              ...create,
            };
            wildernessHexes.push(created);
            return cloneHex(created);
          }
          Object.assign(
            existing,
            Object.fromEntries(
              Object.entries(update).filter(([, value]) => value !== undefined)
            )
          );
          return cloneHex(existing);
        }
      ),
      update: vi.fn(),
      create: vi.fn(),
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
          const keys = Object.keys(update);
          const allowed = ["rations"];
          if (keys.some((key) => !allowed.includes(key))) {
            throw new Error(`Unexpected partyInventory update keys: ${keys.join(", ")}`);
          }
          const existing = partyInventory.find((item) => item.campaignId === where.campaignId);
          if (!existing) {
            partyInventory.push({ ...create });
            return { ...create };
          }
          Object.assign(existing, update);
          return { ...existing };
        }
      ),
      update: vi.fn(),
    },
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    encounter: {
      create: vi.fn(async ({ data }: { data: Omit<EncounterFixture, "id"> }) => {
        const encounter = { id: `encounter-${encounters.length + 1}`, ...data };
        encounters.push(encounter);
        return { ...encounter };
      }),
      update: vi.fn(),
      findFirst: vi.fn(async ({ where }: { where: { campaignId: string; status: string } }) =>
        encounters.find(
          (encounter) =>
            encounter.campaignId === where.campaignId && encounter.status === where.status
        ) ?? null
      ),
    },
    combatant: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
    restState: {
      create: vi.fn(),
      update: vi.fn(),
    },
    navigationNode: {
      create: vi.fn(),
      update: vi.fn(),
    },
    navigationEdge: {
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
    travelStates,
    wildernessHexes,
    partyInventory,
    encounters,
    locations,
    nodes,
    edges,
    tx,
  };
}

function createDb(state = createTx()): ReturnType<typeof createTx> & { db: WildernessDb } {
  const db = {
    ...state.tx,
    $transaction: vi.fn(async (fn: (tx: WildernessTx) => Promise<unknown>) =>
      fn(state.tx)
    ),
  };

  return { ...state, db };
}

async function resolveWatch(
  overrides?: Partial<ResolveTravelWatchInput>,
  state = createTx()
): Promise<unknown> {
  const resolveTravelWatch = await loadResolveTravelWatch();
  return resolveTravelWatch({
    campaignId: "campaign-1",
    userId: "user-1",
    watchAction: "travel",
    direction: 1,
    pace: "normal",
    weatherRoll: 10,
    encounterRoll: 6,
    foragingRoll: 10,
    foragingYieldRoll: 3,
    scoutingRoll: 10,
    tx: state.tx,
    ...overrides,
  });
}

function expectNoUnrelatedWrites(tx: WildernessTx) {
  expect(tx.campaign.update).not.toHaveBeenCalled();
  expect(tx.character.update).not.toHaveBeenCalled();
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
  expect(tx.restState.create).not.toHaveBeenCalled();
  expect(tx.restState.update).not.toHaveBeenCalled();
  expect(tx.navigationNode.create).not.toHaveBeenCalled();
  expect(tx.navigationNode.update).not.toHaveBeenCalled();
  expect(tx.navigationEdge.create).not.toHaveBeenCalled();
  expect(tx.navigationEdge.update).not.toHaveBeenCalled();
  expect(tx.location.create).not.toHaveBeenCalled();
  expect(tx.locationNode.create).not.toHaveBeenCalled();
  expect(tx.locationEdge.create).not.toHaveBeenCalled();
}

describe("wilderness-service resolveTravelWatch contract", () => {
  it("rejects a missing campaign", async () => {
    const state = createTx({ campaigns: [] });

    await expect(resolveWatch({}, state)).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });
  });

  it("rejects a campaign that does not belong to the actor", async () => {
    const state = createTx();

    await expect(resolveWatch({ userId: "user-2" }, state)).rejects.toMatchObject({
      code: "CAMPAIGN_OWNERSHIP_MISMATCH",
    });
  });

  it("rejects invalid input", async () => {
    const state = createTx();

    await expect(resolveWatch({ watchAction: "invalid-action" }, state)).rejects.toMatchObject({
      code: "INVALID_TRAVEL_WATCH_INPUT",
    });
  });

  it("bootstraps a missing travelState according to current executeTravelWatch semantics", async () => {
    const state = createTx({ travelStates: [] });

    const result = await resolveWatch({}, state);

    expect(state.travelStates).toHaveLength(1);
    expect(state.travelStates[0]).toMatchObject({
      campaignId: "campaign-1",
      currentWatch: 1,
      totalWatches: 1,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("uses the current plains fallback when the active wildernessMap hex is missing", async () => {
    const state = createTx({ wildernessHexes: [] });

    const result = await resolveWatch({}, state);

    expect(result).toMatchObject({
      ok: true,
      terrain: expect.any(String),
      biome: expect.any(String),
    });
  });

  it("resolves a valid travel watch", async () => {
    const state = createTx();

    const result = await resolveWatch({}, state);

    expect(result).toMatchObject({
      ok: true,
      action: "travel",
      watchIndex: 1,
      watchName: expect.any(String),
      position: { q: 1, r: 0 },
      facts: expect.objectContaining({
        type: "travel_watch_resolved",
        campaignId: "campaign-1",
        action: "travel",
      }),
    });
  });

  it("updates travelState according to current semantics", async () => {
    const state = createTx();

    await resolveWatch({}, state);

    expect(state.travelStates[0]).toMatchObject({
      currentQ: 1,
      currentR: 0,
      currentWatch: 1,
      totalWatches: 1,
      totalDays: 0,
      watchesTraveledToday: 1,
      watchesSinceRation: 1,
      weatherWatchCounter: 1,
      partialHexProgress: 0,
      partyPace: "normal",
    });
  });

  it("updates wildernessMap only when movement or scouting requires it", async () => {
    const state = createTx();

    await resolveWatch({}, state);

    expect(state.tx.wildernessMap.upsert).toHaveBeenCalled();
    expect(state.wildernessHexes.some((hex) => hex.q === 1 && hex.r === 0 && hex.discovered)).toBe(
      true
    );
  });

  it("consumes rations when the ration interval is reached", async () => {
    const state = createTx({
      travelStates: [{ ...baseTravelStates[0], watchesSinceRation: 5 }],
    });

    const result = await resolveWatch({}, state);

    expect(state.partyInventory[0].rations).toBe(3);
    expect(result).toMatchObject({
      resourceChanges: expect.objectContaining({
        rationsConsumed: 1,
      }),
    });
  });

  it("does not consume resources when no resource interval or action requires it", async () => {
    const state = createTx();
    const before = structuredClone(state.partyInventory);

    await resolveWatch({}, state);

    expect(state.partyInventory).toEqual(before);
    expect(state.tx.partyInventory.upsert).not.toHaveBeenCalled();
  });

  it("updates inventory only in wilderness travel resource fields", async () => {
    const state = createTx({
      travelStates: [{ ...baseTravelStates[0], watchesSinceRation: 5 }],
    });

    await resolveWatch({}, state);

    const updateData = state.tx.partyInventory.upsert.mock.calls[0]?.[0]?.update ?? {};
    expect(Object.keys(updateData)).toEqual(["rations"]);
  });

  it("resolves scouting deterministically in tests", async () => {
    const state = createTx();

    const result = await resolveWatch({ watchAction: "scout", direction: undefined }, state);

    expect(state.tx.wildernessMap.upsert).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({
      scoutingResult: expect.objectContaining({
        revealedHexes: expect.any(Array),
      }),
    });
  });

  it("resolves foraging deterministically in tests", async () => {
    const state = createTx();

    const result = await resolveWatch({
      watchAction: "forage",
      direction: undefined,
      foragingRoll: 10,
      foragingYieldRoll: 3,
    }, state);

    expect(state.partyInventory[0].rations).toBe(9);
    expect(result).toMatchObject({
      foragingResult: expect.objectContaining({
        success: true,
        roll: 10,
        rationGain: 5,
      }),
    });
  });

  it("resolves weather deterministically in tests", async () => {
    const state = createTx({
      travelStates: [{ ...baseTravelStates[0], weatherWatchCounter: 5 }],
    });

    const result = await resolveWatch({ weatherRoll: 13 }, state);

    expect(state.travelStates[0].weatherCondition).toBe("overcast");
    expect(result).toMatchObject({
      weather: {
        condition: "overcast",
        intensity: 0,
        changed: true,
      },
    });
  });

  it("checks random encounters deterministically in tests", async () => {
    const state = createTx();

    const result = await resolveWatch({ encounterRoll: 1 }, state);

    expect(result).toMatchObject({
      encounter: {
        triggered: true,
        roll: 1,
      },
    });
  });

  it("does not create an encounter when no random encounter triggers", async () => {
    const state = createTx();

    await resolveWatch({ encounterRoll: 6 }, state);

    expect(state.tx.encounter.create).not.toHaveBeenCalled();
  });

  it("returns encounter facts without resolving central combat when an encounter triggers", async () => {
    const state = createTx();

    const result = await resolveWatch({ encounterRoll: 1 }, state);

    expect(result).toMatchObject({
      facts: expect.objectContaining({
        encounter: expect.objectContaining({
          triggered: true,
          roll: 1,
        }),
      }),
    });
    expect(state.tx.combatant.create).not.toHaveBeenCalled();
    expect(state.tx.combatant.update).not.toHaveBeenCalled();
  });

  it("does not modify characters outside strictly related wilderness fields", async () => {
    const state = createTx();
    const before = state.characters.map(cloneCharacter);

    await resolveWatch({}, state);

    expect(state.characters).toEqual(before);
    expect(state.tx.character.update).not.toHaveBeenCalled();
  });

  it("does not modify spell slots", async () => {
    const state = createTx();
    const before = state.characters.map((character) => structuredClone(character.spellSlots));

    await resolveWatch({}, state);

    expect(state.characters.map((character) => character.spellSlots)).toEqual(before);
  });

  it("does not modify quests", async () => {
    const state = createTx();

    await resolveWatch({}, state);

    expect(state.tx.quest.create).not.toHaveBeenCalled();
    expect(state.tx.quest.update).not.toHaveBeenCalled();
  });

  it("does not modify economy", async () => {
    const state = createTx();
    const goldBefore = state.campaigns.map((campaign) => campaign.gold);

    await resolveWatch({}, state);

    expect(state.campaigns.map((campaign) => campaign.gold)).toEqual(goldBefore);
    expect(state.tx.trade.create).not.toHaveBeenCalled();
    expect(state.tx.trade.update).not.toHaveBeenCalled();
  });

  it("does not modify social state", async () => {
    const state = createTx();
    const before = state.characters.map((character) => character.socialVersion);

    await resolveWatch({}, state);

    expect(state.characters.map((character) => character.socialVersion)).toEqual(before);
    expect(state.tx.social.create).not.toHaveBeenCalled();
    expect(state.tx.social.update).not.toHaveBeenCalled();
  });

  it("does not modify rest state", async () => {
    const state = createTx();
    const before = state.characters.map((character) => character.restStateVersion);

    await resolveWatch({}, state);

    expect(state.characters.map((character) => character.restStateVersion)).toEqual(before);
    expect(state.tx.restState.create).not.toHaveBeenCalled();
    expect(state.tx.restState.update).not.toHaveBeenCalled();
  });

  it("does not modify the navigation graph", async () => {
    const state = createTx();
    const before = {
      campaigns: state.campaigns.map((campaign) => ({
        currentLocationId: campaign.currentLocationId,
        currentNodeId: campaign.currentNodeId,
      })),
      nodes: structuredClone(state.nodes),
      edges: structuredClone(state.edges),
    };

    await resolveWatch({}, state);

    expect(state.campaigns.map((campaign) => ({
      currentLocationId: campaign.currentLocationId,
      currentNodeId: campaign.currentNodeId,
    }))).toEqual(before.campaigns);
    expect(state.nodes).toEqual(before.nodes);
    expect(state.edges).toEqual(before.edges);
    expect(state.tx.navigationNode.create).not.toHaveBeenCalled();
    expect(state.tx.navigationEdge.create).not.toHaveBeenCalled();
  });

  it("does not create Location, LocationNode, or LocationEdge", async () => {
    const state = createTx();

    await resolveWatch({}, state);

    expect(state.tx.location.create).not.toHaveBeenCalled();
    expect(state.tx.locationNode.create).not.toHaveBeenCalled();
    expect(state.tx.locationEdge.create).not.toHaveBeenCalled();
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const state = createTx();

    await resolveWatch({}, state);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.tx.ai.generateText).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not return long narrative prose", async () => {
    const state = createTx();

    const result = await resolveWatch({}, state);

    expect(JSON.stringify(result)).not.toMatch(
      /\b(narration|narrative|prose|flavorText|boxed text|you travel|you scout)\b/i
    );
    expect(JSON.stringify(result).length).toBeLessThan(3000);
  });

  it("returns structured facts", async () => {
    const state = createTx();

    const result = await resolveWatch({}, state);

    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "travel_watch_resolved",
        campaignId: "campaign-1",
        action: "travel",
        travelState: expect.any(Object),
        wildernessMap: expect.any(Object),
        resourceChanges: expect.any(Object),
      },
    });
  });

  it("uses a transaction when a db is injected instead of a tx", async () => {
    const state = createDb();
    const resolveTravelWatch = await loadResolveTravelWatch();

    await resolveTravelWatch({
      campaignId: "campaign-1",
      userId: "user-1",
      watchAction: "travel",
      direction: 1,
      pace: "normal",
      encounterRoll: 6,
      db: state.db,
    });

    expect(state.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("uses the injected tx without opening its own transaction", async () => {
    const state = createDb();

    await resolveWatch({ tx: state.tx }, state);

    expect(state.db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps compatibility with the current executeTravelWatch response shape", async () => {
    const state = createTx();

    const result = await resolveWatch({}, state);

    expect(result).toHaveProperty("featureDiscovered");
    expect(result).toHaveProperty("encounter");
    expect(result).toHaveProperty("foragingResult");
    expect(result).toEqual(
      expect.objectContaining({
        action: "travel",
        watchIndex: expect.any(Number),
        watchName: expect.any(String),
        totalWatches: expect.any(Number),
        totalDays: expect.any(Number),
        position: expect.objectContaining({ q: expect.any(Number), r: expect.any(Number) }),
        terrain: expect.any(String),
        biome: expect.any(String),
        encounter: expect.anything(),
        weather: expect.objectContaining({
          condition: expect.any(String),
          intensity: expect.any(Number),
          changed: expect.any(Boolean),
        }),
        rationsDepleted: expect.any(Boolean),
        restRequired: expect.any(Boolean),
        movementBlocked: expect.any(Boolean),
        exhaustionRisk: expect.any(Boolean),
        warnings: expect.any(Array),
      })
    );
  });

  it("does not introduce forbidden retro rules or jargon", async () => {
    const state = createTx();

    const result = await resolveWatch({}, state);

    expect(JSON.stringify(result)).not.toMatch(forbiddenRulePattern);
  });

  it("does not touch combat pipeline or resolve attacks", async () => {
    const state = createTx();

    await resolveWatch({ encounterRoll: 1 }, state);

    expect(state.tx.combatant.create).not.toHaveBeenCalled();
    expect(state.tx.combatant.update).not.toHaveBeenCalled();
    expect(state.tx.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("does not finalize encounters", async () => {
    const state = createTx({
      encounters: [
        { id: "encounter-1", campaignId: "campaign-1", status: "active", combatResolved: false },
      ],
    });

    await resolveWatch({}, state);

    expect(state.encounters[0]).toMatchObject({
      status: "active",
      combatResolved: false,
    });
    expect(state.tx.encounter.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) })
    );
  });

  it("does not touch downtime", async () => {
    const state = createTx();
    const before = state.characters.map((character) => character.downtimeVersion);

    await resolveWatch({}, state);

    expect(state.characters.map((character) => character.downtimeVersion)).toEqual(before);
  });

  it("keeps wilderness writes scoped away from unrelated domains", async () => {
    const state = createTx();

    await resolveWatch({}, state);

    expectNoUnrelatedWrites(state.tx);
  });
});


