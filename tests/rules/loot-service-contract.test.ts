import { beforeEach, describe, expect, it, vi } from "vitest";

type CampaignFixture = {
  id: string;
  characterId: string;
  gold: number;
};

type CharacterFixture = {
  id: string;
  campaignId: string;
};

type EncounterFixture = {
  id: string;
  campaignId: string;
  status: string;
  round: number;
  currentTurnIndex: number;
};

type CombatantFixture = {
  id: string;
  encounterId: string;
  name: string;
  isPlayer: boolean;
  hp: number;
};

type InventoryItemFixture = {
  id: string;
  characterId: string;
  campaignId: string;
  name: string;
  type: string;
  quantity: number;
  properties: Record<string, unknown>;
};

type LootItemInput = {
  name: string;
  type: string;
  quantity?: number;
  properties?: Record<string, unknown>;
};

type LootTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  encounter: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  combatant: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

type GrantLootInput = {
  campaignId: string;
  encounterId: string;
  characterId?: string;
  gold?: number;
  items?: LootItemInput[];
  source?: string;
  tx: LootTx;
};

type GrantLoot = (input: GrantLootInput) => Promise<unknown>;

const baseCampaigns: CampaignFixture[] = [
  { id: "campaign-1", characterId: "character-1", gold: 25 },
  { id: "campaign-2", characterId: "character-3", gold: 200 },
];

const baseCharacters: CharacterFixture[] = [
  { id: "character-1", campaignId: "campaign-1" },
  { id: "character-2", campaignId: "campaign-1" },
  { id: "character-3", campaignId: "campaign-2" },
];

const baseEncounters: EncounterFixture[] = [
  {
    id: "encounter-1",
    campaignId: "campaign-1",
    status: "resolved",
    round: 3,
    currentTurnIndex: 1,
  },
  {
    id: "encounter-2",
    campaignId: "campaign-2",
    status: "resolved",
    round: 2,
    currentTurnIndex: 0,
  },
];

const baseCombatants: CombatantFixture[] = [
  { id: "combatant-player", encounterId: "encounter-1", name: "Mira", isPlayer: true, hp: 8 },
  { id: "combatant-bandit", encounterId: "encounter-1", name: "Bandit", isPlayer: false, hp: 0 },
  { id: "combatant-other", encounterId: "encounter-2", name: "Wolf", isPlayer: false, hp: 0 },
];

const baseItems: InventoryItemFixture[] = [
  {
    id: "rope-1",
    characterId: "character-1",
    campaignId: "campaign-1",
    name: "Hempen Rope",
    type: "gear",
    quantity: 2,
    properties: { valueGP: 1 },
  },
  {
    id: "other-character-rope",
    characterId: "character-2",
    campaignId: "campaign-1",
    name: "Hempen Rope",
    type: "gear",
    quantity: 5,
    properties: { valueGP: 1 },
  },
  {
    id: "other-campaign-rope",
    characterId: "character-3",
    campaignId: "campaign-2",
    name: "Hempen Rope",
    type: "gear",
    quantity: 4,
    properties: { valueGP: 1 },
  },
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

async function loadGrantLoot(): Promise<GrantLoot> {
  const modulePath = "../../lib/rules/loot-service";
  const mod = await import(modulePath);
  return mod.grantLoot as GrantLoot;
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  characters?: CharacterFixture[];
  encounters?: EncounterFixture[];
  combatants?: CombatantFixture[];
  items?: InventoryItemFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const characters = (options?.characters ?? baseCharacters).map((character) => ({
    ...character,
  }));
  const encounters = (options?.encounters ?? baseEncounters).map((encounter) => ({
    ...encounter,
  }));
  const combatants = (options?.combatants ?? baseCombatants).map((combatant) => ({
    ...combatant,
  }));
  const items = (options?.items ?? baseItems).map((item) => ({ ...item }));

  const tx: LootTx = {
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
          data: { gold: { increment?: number } };
        }) => {
          const campaign = campaigns.find((candidate) => candidate.id === where.id);
          if (!campaign) throw new Error(`Missing campaign ${where.id}`);
          campaign.gold += data.gold.increment ?? 0;
          return { ...campaign };
        }
      ),
    },
    character: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        characters.find((character) => character.id === where.id) ?? null
      ),
    },
    encounter: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        encounters.find((encounter) => encounter.id === where.id) ?? null
      ),
      update: vi.fn(async ({ where }: { where: { id: string } }) => {
        const encounter = encounters.find((candidate) => candidate.id === where.id);
        if (!encounter) throw new Error(`Missing encounter ${where.id}`);
        return { ...encounter };
      }),
    },
    combatant: {
      findMany: vi.fn(async ({ where }: { where: { encounterId: string } }) =>
        combatants.filter((combatant) => combatant.encounterId === where.encounterId)
      ),
      update: vi.fn(async ({ where }: { where: { id: string } }) => {
        const combatant = combatants.find((candidate) => candidate.id === where.id);
        if (!combatant) throw new Error(`Missing combatant ${where.id}`);
        return { ...combatant };
      }),
    },
    inventoryItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        items.find((item) => matchesItemWhere(item, where)) ?? null
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<InventoryItemFixture, "id" | "campaignId" | "quantity"> & {
            campaignId?: string;
            quantity?: number;
          };
        }) => {
          const item = {
            id: `created-${items.length + 1}`,
            campaignId: data.campaignId ?? characterCampaignId(data.characterId, characters),
            characterId: data.characterId,
            name: data.name,
            type: data.type,
            quantity: data.quantity ?? 1,
            properties: data.properties ?? {},
          };
          items.push(item);
          return { ...item };
        }
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { quantity: number } }) => {
          const item = items.find((candidate) => candidate.id === where.id);
          if (!item) throw new Error(`Missing item ${where.id}`);
          item.quantity = data.quantity;
          return { ...item };
        }
      ),
    },
  };

  return { campaigns, characters, encounters, combatants, items, tx };
}

function matchesItemWhere(
  item: InventoryItemFixture,
  where: Record<string, unknown>
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "name" && isInsensitiveEqualsFilter(expected)) {
      return item.name.toLowerCase() === expected.equals.toLowerCase();
    }

    return item[key as keyof InventoryItemFixture] === expected;
  });
}

function isInsensitiveEqualsFilter(
  value: unknown
): value is { equals: string; mode?: "insensitive" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "equals" in value &&
    typeof value.equals === "string"
  );
}

function characterCampaignId(
  characterId: string,
  characters: CharacterFixture[]
): string {
  return characters.find((character) => character.id === characterId)?.campaignId ?? "";
}

function grantInput(tx: LootTx, overrides?: Partial<GrantLootInput>): GrantLootInput {
  return {
    campaignId: "campaign-1",
    encounterId: "encounter-1",
    characterId: "character-1",
    gold: 15,
    items: [
      {
        name: "Hempen Rope",
        type: "gear",
        quantity: 1,
        properties: { valueGP: 1 },
      },
      {
        name: "Silvered Dagger",
        type: "weapon",
        quantity: 1,
        properties: { valueGP: 100 },
      },
    ],
    source: "encounter_loot",
    tx,
    ...overrides,
  };
}

describe("grantLoot service contract", () => {
  let grantLoot: GrantLoot;

  beforeEach(async () => {
    grantLoot = await loadGrantLoot();
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaigns: [] });

    await expect(grantLoot(grantInput(tx))).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });
  });

  it("rejects a missing encounter", async () => {
    const { tx } = createTx({ encounters: [] });

    await expect(grantLoot(grantInput(tx))).rejects.toMatchObject({
      code: "ENCOUNTER_NOT_FOUND",
    });
  });

  it("rejects an encounter from another campaign", async () => {
    const { tx } = createTx();

    await expect(
      grantLoot(grantInput(tx, { encounterId: "encounter-2" }))
    ).rejects.toMatchObject({ code: "ENCOUNTER_OWNERSHIP_MISMATCH" });
  });

  it("rejects an invalid characterId when provided", async () => {
    const { tx } = createTx();

    await expect(
      grantLoot(grantInput(tx, { characterId: "character-2" }))
    ).rejects.toMatchObject({ code: "CHARACTER_OWNERSHIP_MISMATCH" });
  });

  it("rejects negative gold", async () => {
    const { tx } = createTx();

    await expect(grantLoot(grantInput(tx, { gold: -1 }))).rejects.toMatchObject({
      code: "INVALID_GOLD",
    });
  });

  it("rejects invalid items", async () => {
    const { tx } = createTx();

    await expect(
      grantLoot(grantInput(tx, { items: [{ name: "", type: "gear", quantity: 1 }] }))
    ).rejects.toMatchObject({ code: "INVALID_LOOT_ITEM" });
  });

  it("increments campaign.gold for valid loot", async () => {
    const { campaigns, tx } = createTx();

    const result = await grantLoot(grantInput(tx, { items: [] }));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.gold).toBe(40);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "loot_granted",
        campaignId: "campaign-1",
        encounterId: "encounter-1",
        goldDelta: 15,
        goldBefore: 25,
        goldAfter: 40,
      },
    });
  });

  it("creates inventoryItem when a valid item does not exist", async () => {
    const { items, tx } = createTx();

    await grantLoot(
      grantInput(tx, {
        gold: 0,
        items: [{ name: "Silvered Dagger", type: "weapon", quantity: 1 }],
      })
    );

    expect(items.find((item) => item.name === "Silvered Dagger")).toMatchObject({
      campaignId: "campaign-1",
      characterId: "character-1",
      quantity: 1,
    });
  });

  it("increments quantity when the item already exists", async () => {
    const { items, tx } = createTx();

    await grantLoot(
      grantInput(tx, {
        gold: 0,
        items: [{ name: "Hempen Rope", type: "gear", quantity: 3 }],
      })
    );

    expect(items.find((item) => item.id === "rope-1")?.quantity).toBe(5);
  });

  it("does not touch another campaign", async () => {
    const { campaigns, tx } = createTx();

    await grantLoot(grantInput(tx, { items: [] }));

    expect(campaigns.find((campaign) => campaign.id === "campaign-2")?.gold).toBe(200);
  });

  it("does not touch another character", async () => {
    const { items, tx } = createTx();

    await grantLoot(
      grantInput(tx, {
        gold: 0,
        items: [{ name: "Hempen Rope", type: "gear", quantity: 1 }],
      })
    );

    expect(items.find((item) => item.id === "other-character-rope")?.quantity).toBe(5);
  });

  it("does not touch another encounter", async () => {
    const { tx } = createTx();

    await grantLoot(grantInput(tx, { items: [] }));

    expect(tx.encounter.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "encounter-2" } })
    );
  });

  it("does not generate negative gold", async () => {
    const { campaigns, tx } = createTx({ campaigns: [{ id: "campaign-1", characterId: "character-1", gold: 0 }] });

    await grantLoot(grantInput(tx, { gold: 0, items: [] }));

    expect(campaigns.find((campaign) => campaign.id === "campaign-1")?.gold).toBe(0);
  });

  it("returns structured facts for narration and UI", async () => {
    const { tx } = createTx();

    const result = await grantLoot(grantInput(tx));

    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "loot_granted",
        campaignId: "campaign-1",
        encounterId: "encounter-1",
        characterId: "character-1",
        items: expect.any(Array),
      },
    });
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();

    const result = await grantLoot(grantInput(tx));

    expect(JSON.stringify(result)).not.toMatch(
      /\b(narration|narrative|prose|flavorText|message|treasure glitters)\b/i
    );
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await grantLoot(grantInput(tx));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not introduce forbidden retro rules or progression from loot", async () => {
    const { tx } = createTx();

    const result = await grantLoot(grantInput(tx));

    expect(JSON.stringify(result)).not.toMatch(forbiddenRulePattern);
  });

  it("does not modify combat turns", async () => {
    const { encounters, tx } = createTx();

    await grantLoot(grantInput(tx));

    expect(encounters.find((encounter) => encounter.id === "encounter-1")).toMatchObject({
      round: 3,
      currentTurnIndex: 1,
    });
  });

  it("does not modify combatants", async () => {
    const { tx } = createTx();

    await grantLoot(grantInput(tx));

    expect(tx.combatant.update).not.toHaveBeenCalled();
  });

  it("does not modify encounter state", async () => {
    const { tx } = createTx();

    await grantLoot(grantInput(tx));

    expect(tx.encounter.update).not.toHaveBeenCalled();
  });
});
