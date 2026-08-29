import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnCombatEncounter } from "@/lib/rules/encounter-service";
import type { Monster } from "@/lib/rules/srd";

const wolf: Monster = {
  index: "wolf",
  name: "Wolf",
  hit_points: 11,
  armor_class: [{ type: "natural", value: 13 }],
  type: "beast",
  challenge_rating: 0.25,
  dexterity: 12,
  // Deliberately no `xp` — proves the null/unavailable path for a monster missing it.
};

const goblin: Monster = {
  index: "goblin",
  name: "Goblin",
  hit_points: 7,
  armor_class: [{ type: "natural", value: 15 }],
  type: "humanoid",
  challenge_rating: 0.25,
  dexterity: 14,
  xp: 50,
};

function mockRandom(values: number[]): void {
  let index = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[index++] ?? 0.5);
}

function createDb(options?: {
  campaign?: null | {
    character: {
      id: string;
      name: string;
      hp: number;
      maxHp: number;
      stats: unknown;
      inventory: Array<{ type: string; properties: unknown }>;
    };
  };
  activeEncounter?: null | { id: string };
}) {
  const campaign =
    options?.campaign === undefined
      ? {
          character: {
            id: "char-1",
            name: "Aldric",
            hp: 18,
            maxHp: 20,
            stats: { DEX: 14 },
            inventory: [
              {
                type: "armor",
                equippedSlot: "ARMOR",
                properties: { baseAC: 11, addDexModifier: true },
              },
            ],
          },
        }
      : options.campaign;
  const activeEncounter = options?.activeEncounter ?? null;

  const db = {
    campaign: {
      findUnique: vi.fn(async () => campaign),
    },
    encounter: {
      findFirst: vi.fn(async () => activeEncounter),
      create: vi.fn(async ({ data }) => ({
        id: "enc-1",
        combatants: data.combatants.create
          .map((combatant: { name: string; initiativeTotal: number; isPlayer: boolean; xpValue: number | null }) => ({
            name: combatant.name,
            initiativeTotal: combatant.initiativeTotal,
            isPlayer: combatant.isPlayer,
            xpValue: combatant.xpValue,
          }))
          .sort(
            (
              a: { initiativeTotal: number },
              b: { initiativeTotal: number }
            ) => b.initiativeTotal - a.initiativeTotal
          ),
      })),
    },
  };

  return db;
}

describe("spawnCombatEncounter service contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads campaign state, builds the encounter, persists combatants, and returns serializable facts", async () => {
    const db = createDb();
    const queryMonsters = vi.fn(async () => [wolf]);
    mockRandom([0.9, 0.2]);

    const result = await spawnCombatEncounter({
      campaignId: "campaign-1",
      targetCR: 0.25,
      theme: "beast",
      db,
      queryMonsters,
    });

    expect(result).toMatchObject({
      ok: true,
      encounterId: "enc-1",
      enemies: [{ name: "Wolf", cr: 0.25, hp: 11 }],
      adjustedXP: 50,
      initiativeOrder: [
        { name: "Aldric", initiative: 21, isPlayer: true },
        { name: "Wolf", initiative: 6, isPlayer: false },
      ],
    });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(db.campaign.findUnique).toHaveBeenCalledWith({
      where: { id: "campaign-1" },
      include: { character: { include: { inventory: true } } },
    });
    expect(db.encounter.findFirst).toHaveBeenCalledWith({
      where: { campaignId: "campaign-1", status: "active" },
    });
    expect(queryMonsters).toHaveBeenCalledWith({
      type: "beast",
      maxCR: 0.5,
      limit: 30,
    });
    expect(db.encounter.create).toHaveBeenCalledWith({
      data: {
        campaignId: "campaign-1",
        status: "active",
        round: 1,
        currentTurnIndex: 0,
        combatants: {
          create: [
            {
              name: "Aldric",
              isPlayer: true,
              hp: 18,
              maxHp: 20,
              ac: 13,
              initiativeTotal: 21,
              stats: { DEX: 14 },
              damageImmunities: [],
              damageResistances: [],
              damageVulnerabilities: [],
              xpValue: null,
            },
            {
              name: "Wolf",
              isPlayer: false,
              hp: 11,
              maxHp: 11,
              ac: 13,
              initiativeTotal: 6,
              stats: { STR: 10, DEX: 12, CON: 10, INT: 10, WIS: 10, CHA: 10 },
              damageImmunities: [],
              damageResistances: [],
              damageVulnerabilities: [],
              xpValue: null,
            },
          ],
        },
      },
      include: { combatants: { orderBy: { initiativeTotal: "desc" } } },
    });
  });

  it("persists ability scores on every combatant instead of leaving the column empty", async () => {
    // Combatant.stats existed but nothing ever wrote it, so every combatant sat
    // on the schema default {} and any rule reading a creature's ability score
    // silently got 10. The column was there; the write was missing.
    const db = createDb();
    const queryMonsters = vi.fn(async () => [wolf]);
    mockRandom([0.9, 0.2]);

    await spawnCombatEncounter({
      campaignId: "campaign-1",
      targetCR: 0.25,
      theme: "beast",
      db,
      queryMonsters,
    });

    const call = (db.encounter.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const combatants = call.data.combatants.create as Array<{
      isPlayer: boolean;
      stats: Record<string, number>;
    }>;

    // The player carries the character's own scores, unchanged.
    expect(combatants.find((c) => c.isPlayer)!.stats).toMatchObject({ DEX: 14 });

    // The monster carries its SRD scores under the same three-letter convention
    // the rest of the engine reads (charStats.STR, combatant.stats.DEX, ...).
    // The wolf fixture only declares dexterity, so the rest fall back to 10 —
    // the SRD average — rather than being absent.
    expect(combatants.find((c) => !c.isPlayer)!.stats).toEqual({
      STR: 10,
      DEX: 12,
      CON: 10,
      INT: 10,
      WIS: 10,
      CHA: 10,
    });
  });

  it("persists the monster's exact SrdMonster-authorized xp as the combatant's xpValue snapshot", async () => {
    const db = createDb();
    const queryMonsters = vi.fn(async () => [goblin]);
    mockRandom([0.9, 0.2]);

    await spawnCombatEncounter({
      campaignId: "campaign-1",
      targetCR: 0.25,
      theme: "humanoid",
      db,
      queryMonsters,
    });

    const call = (db.encounter.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const combatants = call.data.combatants.create as Array<{
      name: string;
      isPlayer: boolean;
      xpValue: number | null;
    }>;
    const player = combatants.find((c) => c.isPlayer)!;
    const enemy = combatants.find((c) => !c.isPlayer)!;
    expect(player.xpValue).toBeNull();
    expect(enemy.xpValue).toBe(50);
  });

  it("returns an active-encounter error before querying monsters or creating records", async () => {
    const db = createDb({ activeEncounter: { id: "enc-active" } });
    const queryMonsters = vi.fn(async () => [wolf]);

    const result = await spawnCombatEncounter({
      campaignId: "campaign-1",
      targetCR: 0.25,
      db,
      queryMonsters,
    });

    expect(result).toEqual({
      error: "An active encounter already exists.",
      encounterId: "enc-active",
    });
    expect(queryMonsters).not.toHaveBeenCalled();
    expect(db.encounter.create).not.toHaveBeenCalled();
  });

  it("returns a campaign-not-found error before checking encounters", async () => {
    const db = createDb({ campaign: null });
    const queryMonsters = vi.fn(async () => [wolf]);

    const result = await spawnCombatEncounter({
      campaignId: "missing-campaign",
      targetCR: 0.25,
      db,
      queryMonsters,
    });

    expect(result).toEqual({ error: "Campaign not found." });
    expect(db.encounter.findFirst).not.toHaveBeenCalled();
    expect(queryMonsters).not.toHaveBeenCalled();
  });

  it("returns a no-suitable-monsters error without creating an encounter", async () => {
    const db = createDb();
    const queryMonsters = vi.fn(async () => []);

    const result = await spawnCombatEncounter({
      campaignId: "campaign-1",
      targetCR: 0.25,
      theme: "undead",
      db,
      queryMonsters,
    });

    expect(result).toEqual({
      error: "No suitable monsters found for this encounter configuration.",
    });
    expect(db.encounter.create).not.toHaveBeenCalled();
  });
});

describe("damage modifiers reach the combatant", () => {
  afterEach(() => vi.restoreAllMocks());

  it("copies all three arrays from the monster onto the spawned combatant", async () => {
    // The monster the fixture spawns must carry modifiers for this to mean
    // anything; assert that first so a fixture change cannot make this vacuous.
    const fireElemental: Monster = {
      index: "fire-elemental",
      name: "Fire Elemental",
      hit_points: 102,
      armor_class: [{ type: "natural", value: 13 }],
      type: "elemental",
      challenge_rating: 5,
      dexterity: 17,
      damage_immunities: ["fire", "poison"],
      damage_resistances: [
        "bludgeoning, piercing, and slashing from nonmagical weapons",
      ],
      damage_vulnerabilities: [],
    };
    const db = createDb();
    const queryMonsters = vi.fn(async () => [fireElemental]);
    mockRandom([0.9, 0.2]);

    await spawnCombatEncounter({
      campaignId: "campaign-1",
      targetCR: 5,
      theme: "elemental",
      db,
      queryMonsters,
    });

    const call = (db.encounter.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const combatants = call.data.combatants.create as Array<{
      isPlayer: boolean;
      damageImmunities: string[];
      damageResistances: string[];
      damageVulnerabilities: string[];
    }>;
    const enemy = combatants.find((c) => !c.isPlayer)!;

    expect(enemy.damageImmunities).toEqual(["fire", "poison"]);
    expect(enemy.damageResistances).toEqual([
      "bludgeoning, piercing, and slashing from nonmagical weapons",
    ]);
    expect(enemy.damageVulnerabilities).toEqual([]);
  });

  it("gives the player three empty arrays, never undefined", async () => {
    // A rule reading `undefined.length` is the failure this prevents. Nothing
    // in this codebase grants a player resistance, so empty is the truth.
    const db = createDb();
    const queryMonsters = vi.fn(async () => [wolf]);
    mockRandom([0.9, 0.2]);

    await spawnCombatEncounter({
      campaignId: "campaign-1",
      targetCR: 0.25,
      theme: "beast",
      db,
      queryMonsters,
    });

    const call = (db.encounter.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const combatants = call.data.combatants.create as Array<{
      isPlayer: boolean;
      damageImmunities: string[];
      damageResistances: string[];
      damageVulnerabilities: string[];
    }>;
    const player = combatants.find((c) => c.isPlayer)!;

    expect(player.damageImmunities).toEqual([]);
    expect(player.damageResistances).toEqual([]);
    expect(player.damageVulnerabilities).toEqual([]);
  });
});
