import { describe, expect, it, vi } from "vitest";

type SpellSlotsFixture = Record<string, { current: number; max: number }>;

type CampaignFixture = {
  id: string;
  userId: string;
};

type CharacterFixture = {
  id: string;
  campaignId: string;
  spellSlots: SpellSlotsFixture | null;
  inventoryVersion: number;
  combatVersion: number;
  questVersion: number;
  economyVersion: number;
};

type SpellFixture = {
  id: string;
  level: number;
  name: string;
};

type MagicTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  srdSpell: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  inventoryItem: {
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  combatant: {
    update: ReturnType<typeof vi.fn>;
  };
  quest: {
    update: ReturnType<typeof vi.fn>;
  };
  trade: {
    update: ReturnType<typeof vi.fn>;
  };
};

type CastSpellInput = {
  campaignId: string;
  characterId: string;
  spellId: string;
  spellLevel: number;
  slotLevel?: number;
  tx: MagicTx;
};

type CastSpell = (input: CastSpellInput) => Promise<unknown>;

const baseCampaigns: CampaignFixture[] = [
  { id: "campaign-1", userId: "user-1" },
  { id: "campaign-2", userId: "user-2" },
];

const baseCharacters: CharacterFixture[] = [
  {
    id: "character-1",
    campaignId: "campaign-1",
    spellSlots: {
      "1": { current: 2, max: 2 },
      "2": { current: 1, max: 1 },
      "3": { current: 0, max: 1 },
    },
    inventoryVersion: 1,
    combatVersion: 1,
    questVersion: 1,
    economyVersion: 1,
  },
  {
    id: "character-2",
    campaignId: "campaign-1",
    spellSlots: {
      "1": { current: 1, max: 1 },
      "2": { current: 0, max: 1 },
    },
    inventoryVersion: 1,
    combatVersion: 1,
    questVersion: 1,
    economyVersion: 1,
  },
  {
    id: "character-3",
    campaignId: "campaign-2",
    spellSlots: {
      "1": { current: 1, max: 1 },
    },
    inventoryVersion: 1,
    combatVersion: 1,
    questVersion: 1,
    economyVersion: 1,
  },
];

const baseSpells: SpellFixture[] = [
  { id: "fire-bolt", level: 0, name: "Fire Bolt" },
  { id: "magic-missile", level: 1, name: "Magic Missile" },
  { id: "scorching-ray", level: 2, name: "Scorching Ray" },
  { id: "fireball", level: 3, name: "Fireball" },
];

async function loadCastSpell(): Promise<CastSpell> {
  const modulePath = "../../lib/rules/magic-service";
  const mod = await import(modulePath);
  return mod.castSpell as CastSpell;
}

function cloneSlots(slots: SpellSlotsFixture | null): SpellSlotsFixture | null {
  if (!slots) return null;
  return Object.fromEntries(
    Object.entries(slots).map(([level, entry]) => [level, { ...entry }])
  );
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  characters?: CharacterFixture[];
  spells?: SpellFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const characters = (options?.characters ?? baseCharacters).map((character) => ({
    ...character,
    spellSlots: cloneSlots(character.spellSlots),
  }));
  const spells = (options?.spells ?? baseSpells).map((spell) => ({ ...spell }));

  const tx: MagicTx = {
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
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<CharacterFixture>;
        }) => {
          const character = characters.find((candidate) => candidate.id === where.id);
          if (!character) throw new Error(`Missing character ${where.id}`);
          const allowedKeys = Object.keys(data);
          if (allowedKeys.some((key) => key !== "spellSlots")) {
            throw new Error(`Unexpected character update keys: ${allowedKeys.join(", ")}`);
          }
          character.spellSlots = cloneSlots(data.spellSlots ?? character.spellSlots);
          return { ...character, spellSlots: cloneSlots(character.spellSlots) };
        }
      ),
    },
    srdSpell: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        spells.find((spell) => spell.id === where.id) ?? null
      ),
    },
    inventoryItem: {
      update: vi.fn(),
      delete: vi.fn(),
    },
    combatant: {
      update: vi.fn(),
    },
    quest: {
      update: vi.fn(),
    },
    trade: {
      update: vi.fn(),
    },
  };

  return { campaigns, characters, spells, tx };
}

async function cast(input: CastSpellInput): Promise<unknown> {
  const castSpell = await loadCastSpell();
  return castSpell(input);
}

function expectNoCrossDomainWrites(tx: MagicTx) {
  expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  expect(tx.combatant.update).not.toHaveBeenCalled();
  expect(tx.quest.update).not.toHaveBeenCalled();
  expect(tx.trade.update).not.toHaveBeenCalled();
  expect(tx.campaign.update).not.toHaveBeenCalled();
}

describe("castSpell magic service contract", () => {
  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaigns: [baseCampaigns[0]] });

    await expect(
      cast({
        campaignId: "missing-campaign",
        characterId: "character-1",
        spellId: "magic-missile",
        spellLevel: 1,
        slotLevel: 1,
        tx,
      })
    ).rejects.toMatchObject({ code: "CAMPAIGN_NOT_FOUND" });
  });

  it("rejects a missing character", async () => {
    const { tx } = createTx();

    await expect(
      cast({
        campaignId: "campaign-1",
        characterId: "missing-character",
        spellId: "magic-missile",
        spellLevel: 1,
        slotLevel: 1,
        tx,
      })
    ).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
  });

  it("rejects a character from another campaign", async () => {
    const { tx } = createTx();

    await expect(
      cast({
        campaignId: "campaign-1",
        characterId: "character-3",
        spellId: "magic-missile",
        spellLevel: 1,
        slotLevel: 1,
        tx,
      })
    ).rejects.toMatchObject({ code: "CHARACTER_CAMPAIGN_MISMATCH" });
  });

  it("rejects an invalid spellId", async () => {
    const { tx } = createTx();

    await expect(
      cast({
        campaignId: "campaign-1",
        characterId: "character-1",
        spellId: "missing-spell",
        spellLevel: 1,
        slotLevel: 1,
        tx,
      })
    ).rejects.toMatchObject({ code: "SPELL_NOT_FOUND" });
  });

  it("rejects an invalid spellLevel", async () => {
    const { tx } = createTx();

    await expect(
      cast({
        campaignId: "campaign-1",
        characterId: "character-1",
        spellId: "magic-missile",
        spellLevel: 10,
        slotLevel: 1,
        tx,
      })
    ).rejects.toMatchObject({ code: "INVALID_SPELL_LEVEL" });
  });

  it("rejects an invalid slotLevel", async () => {
    const { tx } = createTx();

    await expect(
      cast({
        campaignId: "campaign-1",
        characterId: "character-1",
        spellId: "magic-missile",
        spellLevel: 1,
        slotLevel: 10,
        tx,
      })
    ).rejects.toMatchObject({ code: "INVALID_SLOT_LEVEL" });
  });

  it("rejects slotLevel lower than spellLevel", async () => {
    const { tx } = createTx();

    await expect(
      cast({
        campaignId: "campaign-1",
        characterId: "character-1",
        spellId: "scorching-ray",
        spellLevel: 2,
        slotLevel: 1,
        tx,
      })
    ).rejects.toMatchObject({ code: "SLOT_LEVEL_TOO_LOW" });
  });

  it("rejects a leveled spell without available slots", async () => {
    const { tx } = createTx();

    await expect(
      cast({
        campaignId: "campaign-1",
        characterId: "character-1",
        spellId: "fireball",
        spellLevel: 3,
        slotLevel: 3,
        tx,
      })
    ).rejects.toMatchObject({ code: "NO_SPELL_SLOT_AVAILABLE" });
  });

  it("rejects negative spell slots", async () => {
    const characters = baseCharacters.map((character) =>
      character.id === "character-1"
        ? {
            ...character,
            spellSlots: { "1": { current: -1, max: 2 } },
          }
        : character
    );
    const { tx } = createTx({ characters });

    await expect(
      cast({
        campaignId: "campaign-1",
        characterId: "character-1",
        spellId: "magic-missile",
        spellLevel: 1,
        slotLevel: 1,
        tx,
      })
    ).rejects.toMatchObject({ code: "INVALID_SPELL_SLOTS" });
  });

  it("does not consume a spell slot for a cantrip", async () => {
    const { characters, tx } = createTx();

    const result = await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "fire-bolt",
      spellLevel: 0,
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.spellSlots).toEqual(
      baseCharacters[0].spellSlots
    );
    expect(tx.character.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "spell_cast",
        spellId: "fire-bolt",
        spellLevel: 0,
        slotLevel: null,
        slotConsumed: false,
      },
    });
  });

  it("consumes exactly one level 1 slot for a level 1 spell cast with slotLevel 1", async () => {
    const { characters, tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.spellSlots).toMatchObject({
      "1": { current: 1, max: 2 },
      "2": { current: 1, max: 1 },
      "3": { current: 0, max: 1 },
    });
  });

  it("consumes exactly the selected higher-level slot when upcast", async () => {
    const { characters, tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 2,
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.spellSlots).toMatchObject({
      "1": { current: 2, max: 2 },
      "2": { current: 0, max: 1 },
      "3": { current: 0, max: 1 },
    });
  });

  it("does not touch slots at other levels", async () => {
    const { characters, tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.spellSlots?.["2"]).toEqual({
      current: 1,
      max: 1,
    });
    expect(characters.find((character) => character.id === "character-1")?.spellSlots?.["3"]).toEqual({
      current: 0,
      max: 1,
    });
  });

  it("does not touch another character", async () => {
    const { characters, tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(characters.find((character) => character.id === "character-2")?.spellSlots).toEqual(
      baseCharacters[1].spellSlots
    );
  });

  it("does not touch another campaign", async () => {
    const { characters, tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(characters.find((character) => character.campaignId === "campaign-2")?.spellSlots).toEqual(
      baseCharacters[2].spellSlots
    );
  });

  it("updates only character.spellSlots", async () => {
    const { tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(tx.character.update).toHaveBeenCalledTimes(1);
    expect(tx.character.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "character-1" },
        data: {
          spellSlots: expect.objectContaining({
            "1": { current: 1, max: 2 },
          }),
        },
      })
    );
  });

  it("returns structured facts for UI and narration", async () => {
    const { tx } = createTx();

    const result = await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "spell_cast",
        campaignId: "campaign-1",
        characterId: "character-1",
        spellId: "magic-missile",
        spellLevel: 1,
        slotLevel: 1,
        slotConsumed: true,
      },
    });
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();

    const result = await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(JSON.stringify(result)).not.toMatch(
      /\b(narration|narrative|prose|flavorText|message|boxed text)\b/i
    );
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not modify inventory", async () => {
    const { tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  });

  it("does not modify combat", async () => {
    const { tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(tx.combatant.update).not.toHaveBeenCalled();
  });

  it("does not modify quests", async () => {
    const { tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(tx.quest.update).not.toHaveBeenCalled();
  });

  it("does not modify economy", async () => {
    const { tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(tx.trade.update).not.toHaveBeenCalled();
  });

  it("keeps spell casting scoped away from unrelated domains", async () => {
    const { tx } = createTx();

    await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expectNoCrossDomainWrites(tx);
  });

  it("does not introduce AD&D or OSR mechanics", async () => {
    const { tx } = createTx();

    const result = await cast({
      campaignId: "campaign-1",
      characterId: "character-1",
      spellId: "magic-missile",
      spellLevel: 1,
      slotLevel: 1,
      tx,
    });

    expect(JSON.stringify(result)).not.toMatch(
      /AD&D|OSR|THAC0|descending AC|AC descendente|saving throw vs|save vs death|save vs wands|gold for XP|XP por oro/i
    );
  });
});
