import { describe, expect, it, vi } from "vitest";

type SpellSlotsFixture = Record<string, { current: number; max: number }>;

type CampaignFixture = {
  id: string;
  userId: string;
  characterId: string;
};

type CharacterFixture = {
  id: string;
  campaignId: string;
  hp: number;
  maxHp: number;
  level: number;
  class: string;
  stats: Record<string, number>;
  spellSlots: SpellSlotsFixture | null;
  hitDiceTotal: number;
  hitDiceRemaining: number;
  exhaustionLevel: number;
  inventoryVersion: number;
  combatVersion: number;
  encounterVersion: number;
  questVersion: number;
  economyVersion: number;
};

type EncounterFixture = {
  id: string;
  campaignId: string;
  status: "active" | "completed";
  version: number;
};

type RestTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  character: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  encounter: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
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

type ResolveRestInput = {
  campaignId: string;
  characterId?: string;
  restType: "short" | "long" | string;
  hitDiceToSpend?: number;
  roll?: (notation: string) => { total: number };
  tx: RestTx;
};

type ResolveRest = (input: ResolveRestInput) => Promise<unknown>;

const baseCampaigns: CampaignFixture[] = [
  { id: "campaign-1", userId: "user-1", characterId: "character-1" },
  { id: "campaign-2", userId: "user-2", characterId: "character-3" },
];

const baseCharacters: CharacterFixture[] = [
  {
    id: "character-1",
    campaignId: "campaign-1",
    hp: 4,
    maxHp: 12,
    level: 3,
    class: "Fighter",
    stats: { CON: 14, constitution: 14 },
    spellSlots: {
      "1": { current: 0, max: 2 },
      "2": { current: 0, max: 1 },
    },
    hitDiceTotal: 3,
    hitDiceRemaining: 2,
    exhaustionLevel: 1,
    inventoryVersion: 1,
    combatVersion: 1,
    encounterVersion: 1,
    questVersion: 1,
    economyVersion: 1,
  },
  {
    id: "character-2",
    campaignId: "campaign-1",
    hp: 8,
    maxHp: 10,
    level: 2,
    class: "Wizard",
    stats: { CON: 10, constitution: 10 },
    spellSlots: {
      "1": { current: 1, max: 3 },
    },
    hitDiceTotal: 2,
    hitDiceRemaining: 1,
    exhaustionLevel: 0,
    inventoryVersion: 1,
    combatVersion: 1,
    encounterVersion: 1,
    questVersion: 1,
    economyVersion: 1,
  },
  {
    id: "character-3",
    campaignId: "campaign-2",
    hp: 3,
    maxHp: 9,
    level: 2,
    class: "Cleric",
    stats: { CON: 12, constitution: 12 },
    spellSlots: {
      "1": { current: 0, max: 3 },
    },
    hitDiceTotal: 2,
    hitDiceRemaining: 1,
    exhaustionLevel: 0,
    inventoryVersion: 1,
    combatVersion: 1,
    encounterVersion: 1,
    questVersion: 1,
    economyVersion: 1,
  },
];

const baseEncounters: EncounterFixture[] = [
  { id: "encounter-old", campaignId: "campaign-1", status: "completed", version: 1 },
  { id: "encounter-other", campaignId: "campaign-2", status: "completed", version: 1 },
];

async function loadResolveRest(): Promise<ResolveRest> {
  const modulePath = "../../lib/rules/rest-service";
  const mod = await import(modulePath);
  return mod.resolveRest as ResolveRest;
}

function cloneSlots(slots: SpellSlotsFixture | null): SpellSlotsFixture | null {
  if (!slots) return null;
  return Object.fromEntries(
    Object.entries(slots).map(([level, entry]) => [level, { ...entry }])
  );
}

function cloneCharacter(character: CharacterFixture): CharacterFixture {
  return {
    ...character,
    stats: { ...character.stats },
    spellSlots: cloneSlots(character.spellSlots),
  };
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  characters?: CharacterFixture[];
  encounters?: EncounterFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const characters = (options?.characters ?? baseCharacters).map(cloneCharacter);
  const encounters = (options?.encounters ?? baseEncounters).map((encounter) => ({
    ...encounter,
  }));

  const tx: RestTx = {
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
          const permitted = ["hp", "spellSlots", "hitDiceRemaining", "exhaustionLevel"];
          if (allowedKeys.some((key) => !permitted.includes(key))) {
            throw new Error(`Unexpected character update keys: ${allowedKeys.join(", ")}`);
          }
          if (data.hp !== undefined) character.hp = data.hp;
          if (data.spellSlots !== undefined) {
            character.spellSlots = cloneSlots(data.spellSlots);
          }
          if (data.hitDiceRemaining !== undefined) {
            character.hitDiceRemaining = data.hitDiceRemaining;
          }
          if (data.exhaustionLevel !== undefined) {
            character.exhaustionLevel = data.exhaustionLevel;
          }
          return cloneCharacter(character);
        }
      ),
    },
    encounter: {
      findFirst: vi.fn(async ({ where }: { where: { campaignId: string; status: string } }) =>
        encounters.find(
          (encounter) =>
            encounter.campaignId === where.campaignId && encounter.status === where.status
        ) ?? null
      ),
      update: vi.fn(),
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

  return { campaigns, characters, encounters, tx };
}

async function resolveRest(input: ResolveRestInput): Promise<unknown> {
  const service = await loadResolveRest();
  return service(input);
}

function deterministicRoll(total: number) {
  return vi.fn((notation: string) => ({ notation, total }));
}

function expectNoCrossDomainWrites(tx: RestTx) {
  expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  expect(tx.combatant.update).not.toHaveBeenCalled();
  expect(tx.encounter.update).not.toHaveBeenCalled();
  expect(tx.quest.update).not.toHaveBeenCalled();
  expect(tx.trade.update).not.toHaveBeenCalled();
  expect(tx.campaign.update).not.toHaveBeenCalled();
}

describe("resolveRest service contract", () => {
  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaigns: [baseCampaigns[0]] });

    await expect(
      resolveRest({
        campaignId: "missing-campaign",
        characterId: "character-1",
        restType: "short",
        tx,
      })
    ).rejects.toMatchObject({ code: "CAMPAIGN_NOT_FOUND" });
  });

  it("rejects a missing character", async () => {
    const { tx } = createTx();

    await expect(
      resolveRest({
        campaignId: "campaign-1",
        characterId: "missing-character",
        restType: "short",
        tx,
      })
    ).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
  });

  it("rejects a character from another campaign", async () => {
    const { tx } = createTx();

    await expect(
      resolveRest({
        campaignId: "campaign-1",
        characterId: "character-3",
        restType: "short",
        tx,
      })
    ).rejects.toMatchObject({ code: "CHARACTER_CAMPAIGN_MISMATCH" });
  });

  it("rejects an invalid restType", async () => {
    const { tx } = createTx();

    await expect(
      resolveRest({
        campaignId: "campaign-1",
        characterId: "character-1",
        restType: "camp",
        tx,
      })
    ).rejects.toMatchObject({ code: "INVALID_REST_TYPE" });
  });

  it("rejects rest while an encounter is active", async () => {
    const { tx } = createTx({
      encounters: [
        ...baseEncounters,
        { id: "encounter-active", campaignId: "campaign-1", status: "active", version: 1 },
      ],
    });

    await expect(
      resolveRest({
        campaignId: "campaign-1",
        characterId: "character-1",
        restType: "short",
        tx,
      })
    ).rejects.toMatchObject({ code: "ACTIVE_ENCOUNTER" });
  });

  it("short rest recovers HP using spent Hit Dice", async () => {
    const { characters, tx } = createTx();

    const result = await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "short",
      hitDiceToSpend: 1,
      roll: deterministicRoll(6),
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.hp).toBe(12);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "rest_resolved",
        restType: "short",
        hpBefore: 4,
        hpAfter: 12,
        hitDiceSpent: 1,
      },
    });
  });

  /**
   * SRD: "A short rest is a period of downtime, at least 1 hour long" and "A
   * character CAN spend one or more Hit Dice at the end of a short rest"
   * (Adventuring.md:166-168). Taking the rest is not conditional on having
   * dice, and spending them is a choice the player makes per die.
   *
   * These two cases are where an implicit request — a player who typed "short
   * rest" and named no die count — must not be turned into either a refusal or
   * a wasted resource.
   */
  it("spends no Hit Die at full health, and still resolves", async () => {
    // Nobody would choose to burn a die for nothing, and only a long rest
    // returns one — half the total at a time. Silently spending it was the
    // worse of the two edges: a 200 that destroys a resource.
    const healthy = baseCharacters.map((character) =>
      character.id === "character-1"
        ? { ...character, hp: character.maxHp }
        : character
    );
    const { characters, tx } = createTx({ characters: healthy });

    const result = await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "short",
      roll: deterministicRoll(6),
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      facts: { restType: "short", hpRecovered: 0, hitDiceSpent: 0 },
    });
    expect(
      characters.find((character) => character.id === "character-1")?.hitDiceRemaining
    ).toBe(2);
  });

  it("resolves a short rest with no Hit Dice left instead of refusing it", async () => {
    // The rest is legal; it simply recovers nothing. Refusing it also cost the
    // narrator the event, since a 4xx writes no canonical player row.
    const spent = baseCharacters.map((character) =>
      character.id === "character-1"
        ? { ...character, hitDiceRemaining: 0 }
        : character
    );
    const { characters, tx } = createTx({ characters: spent });

    const result = await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "short",
      roll: deterministicRoll(6),
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      facts: { restType: "short", hpRecovered: 0, hitDiceSpent: 0 },
    });
    expect(characters.find((character) => character.id === "character-1")?.hp).toBe(4);
  });

  it("still refuses an explicit request for more dice than are available", async () => {
    // The distinction the two cases above turn on: an implicit rest that
    // cannot use a die is not an error, but asking for a die count that does
    // not exist is. This guard must survive the change.
    const { tx } = createTx();

    await expect(
      resolveRest({
        campaignId: "campaign-1",
        characterId: "character-1",
        restType: "short",
        hitDiceToSpend: 3,
        tx,
      })
    ).rejects.toMatchObject({ code: "INVALID_HIT_DICE" });
  });

  it("short rest does not restore all spell slots", async () => {
    const { characters, tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "short",
      hitDiceToSpend: 1,
      roll: deterministicRoll(4),
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.spellSlots).toEqual(
      baseCharacters[0].spellSlots
    );
  });

  it("long rest restores HP", async () => {
    const { characters, tx } = createTx();

    const result = await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.hp).toBe(12);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        restType: "long",
        hpBefore: 4,
        hpAfter: 12,
      },
    });
  });

  it("long rest restores spell slots using magic-compatible slot shape", async () => {
    const { characters, tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.spellSlots).toEqual({
      "1": { current: 2, max: 2 },
      "2": { current: 1, max: 1 },
    });
  });

  it("does not allow HP above maxHp", async () => {
    const characters = baseCharacters.map((character) =>
      character.id === "character-1" ? { ...character, hp: 11, maxHp: 12 } : character
    );
    const { tx, characters: nextCharacters } = createTx({ characters });

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "short",
      hitDiceToSpend: 1,
      roll: deterministicRoll(10),
      tx,
    });

    expect(nextCharacters.find((character) => character.id === "character-1")?.hp).toBe(12);
  });

  it("does not allow HP below 0", async () => {
    const characters = baseCharacters.map((character) =>
      character.id === "character-1" ? { ...character, hp: -3 } : character
    );
    const { tx, characters: nextCharacters } = createTx({ characters });

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(nextCharacters.find((character) => character.id === "character-1")?.hp).toBeGreaterThanOrEqual(0);
  });

  it("rejects invalid Hit Dice spend", async () => {
    const { tx } = createTx();

    await expect(
      resolveRest({
        campaignId: "campaign-1",
        characterId: "character-1",
        restType: "short",
        hitDiceToSpend: 99,
        tx,
      })
    ).rejects.toMatchObject({ code: "INVALID_HIT_DICE" });
  });

  it("spends Hit Dice when short rest healing uses them", async () => {
    const { characters, tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "short",
      hitDiceToSpend: 1,
      roll: deterministicRoll(4),
      tx,
    });

    expect(characters.find((character) => character.id === "character-1")?.hitDiceRemaining).toBe(1);
  });

  it("does not touch another character", async () => {
    const { characters, tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(characters.find((character) => character.id === "character-2")).toMatchObject(
      baseCharacters[1]
    );
  });

  it("does not touch another campaign", async () => {
    const { characters, tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(characters.find((character) => character.campaignId === "campaign-2")).toMatchObject(
      baseCharacters[2]
    );
  });

  it("updates only character fields related to rest", async () => {
    const { tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    const updateData = tx.character.update.mock.calls[0]?.[0]?.data ?? {};
    expect(Object.keys(updateData).sort()).toEqual(
      ["exhaustionLevel", "hitDiceRemaining", "hp", "spellSlots"].sort()
    );
  });

  it("does not modify inventory", async () => {
    const { tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  });

  it("does not modify combat", async () => {
    const { tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(tx.combatant.update).not.toHaveBeenCalled();
  });

  it("does not modify encounter", async () => {
    const { tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(tx.encounter.update).not.toHaveBeenCalled();
  });

  it("does not modify quests", async () => {
    const { tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(tx.quest.update).not.toHaveBeenCalled();
  });

  it("does not modify economy", async () => {
    const { tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(tx.trade.update).not.toHaveBeenCalled();
  });

  it("returns structured facts for UI and narration", async () => {
    const { tx } = createTx();

    const result = await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(result).toMatchObject({
      ok: true,
      facts: {
        type: "rest_resolved",
        campaignId: "campaign-1",
        characterId: "character-1",
        restType: "long",
      },
    });
  });

  it("does not return narrative text", async () => {
    const { tx } = createTx();

    const result = await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(JSON.stringify(result)).not.toMatch(
      /\b(narration|narrative|prose|flavorText|message|boxed text)\b/i
    );
  });

  it("does not call AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not introduce forbidden retro mechanics", async () => {
    const { tx } = createTx();

    const result = await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expect(JSON.stringify(result)).not.toMatch(
      /AD&D|OSR|THAC0|descending AC|AC descendente|saving throw vs|save vs death|save vs wands|gold for XP|XP por oro/i
    );
  });

  it("keeps rest scoped away from unrelated domains", async () => {
    const { tx } = createTx();

    await resolveRest({
      campaignId: "campaign-1",
      characterId: "character-1",
      restType: "long",
      tx,
    });

    expectNoCrossDomainWrites(tx);
  });
});
