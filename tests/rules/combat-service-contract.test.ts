import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCombatAttack } from "@/lib/rules/combat-service";
import type { ArmorInventoryRow } from "@/lib/rules/armor-class";

type CombatantFixture = {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  ac: number;
  conditions: unknown;
  stats: unknown;
  concentrationSpellId: string | null;
};

function mockRandom(values: number[]): void {
  let index = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[index++] ?? 0.5);
}

function buildPlayer(overrides: Partial<CombatantFixture> = {}): CombatantFixture {
  return {
    id: "player-1",
    name: "Aldric",
    isPlayer: true,
    hp: 20,
    maxHp: 20,
    ac: 15,
    conditions: [],
    stats: { STR: 16, DEX: 12, CON: 10, INT: 10, WIS: 10, CHA: 8 },
    concentrationSpellId: null,
    ...overrides,
  };
}

function buildEnemy(overrides: Partial<CombatantFixture> = {}): CombatantFixture {
  return {
    id: "enemy-1",
    name: "Goblin",
    isPlayer: false,
    hp: 15,
    maxHp: 15,
    ac: 10,
    conditions: [],
    stats: { STR: 8, DEX: 10, CON: 10, INT: 8, WIS: 8, CHA: 8 },
    concentrationSpellId: null,
    ...overrides,
  };
}

function createTx(options?: {
  campaignId?: string;
  characterId?: string | null;
  /** The campaign character as the armour-penalty select reads it. */
  character?: { class: string; inventory: ArmorInventoryRow[] } | null;
  encounter?: null | {
    id: string;
    campaignId: string;
    round: number;
    currentTurnIndex: number;
    totalDamageDealt: number;
    status: string;
    combatants: CombatantFixture[];
  };
}) {
  const campaignId = options?.campaignId ?? "campaign-1";
  const encounter =
    options?.encounter === undefined
      ? {
          id: "enc-1",
          campaignId,
          round: 1,
          currentTurnIndex: 0,
          totalDamageDealt: 0,
          status: "active",
          combatants: [buildPlayer(), buildEnemy()],
        }
      : options.encounter;

  const tx = {
    encounter: {
      findFirst: vi.fn(
        async ({ where }: { where: { campaignId: string; status: string } }) =>
          encounter &&
          encounter.campaignId === where.campaignId &&
          encounter.status === where.status
            ? encounter
            : null
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { totalDamageDealt?: { increment: number } };
        }) => {
          if (!encounter || encounter.id !== where.id) {
            throw new Error(`Missing encounter ${where.id}`);
          }

          const increment = data.totalDamageDealt?.increment ?? 0;
          encounter.totalDamageDealt += increment;
          return { ...encounter };
        }
      ),
    },
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === campaignId
          ? {
              characterId: options?.characterId ?? "character-1",
              character: options?.character ?? null,
            }
          : null
      ),
    },
    combatant: {
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<CombatantFixture>;
        }) => {
          const combatant = encounter?.combatants.find((candidate) => candidate.id === where.id);
          if (!combatant) throw new Error(`Missing combatant ${where.id}`);
          Object.assign(combatant, data);
          return { ...combatant };
        }
      ),
    },
    character: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    inventoryItem: {
      delete: vi.fn(),
      update: vi.fn(),
    },
  };

  return { encounter, tx };
}

async function resolveAttack(
  tx: ReturnType<typeof createTx>["tx"],
  overrides: Partial<Parameters<typeof resolveCombatAttack>[0]> = {}
) {
  return resolveCombatAttack({
    campaignId: "campaign-1",
    attackerId: "player-1",
    targetId: "enemy-1",
    weaponDamageDice: "1d4",
    attackModifier: 0,
    damageType: "piercing",
    tx,
    ...overrides,
  });
}

describe("resolveCombatAttack combat service contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the active encounter, resolves the attack, persists HP, and returns serializable facts", async () => {
    const { tx } = createTx();
    mockRandom([0.5, 0.5, 0.3]);

    const result = await resolveAttack(tx);

    expect(result.ok).toBe(true);
    expect(result.combat_facts).toMatchObject({
      attacker: "Aldric",
      defender: "Goblin",
      damage: 3,
      hp_before: 15,
      hp_after: 12,
      damage_type: "piercing",
    });
    expect(result.combat_beat).toBe("first_blood");
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(tx.combatant.update).toHaveBeenCalledWith({
      where: { id: "enemy-1" },
      data: { hp: 12, conditions: [] },
    });
  });

  it("increments totalDamageDealt exactly once through the combat pipeline", async () => {
    const { tx } = createTx();
    mockRandom([0.5, 0.5, 0.3]);

    await resolveAttack(tx);

    expect(tx.encounter.update).toHaveBeenCalledTimes(1);
    expect(tx.encounter.update).toHaveBeenCalledWith({
      where: { id: "enc-1" },
      data: { totalDamageDealt: { increment: 3 } },
    });
  });

  it("does not increment totalDamageDealt when the attack deals zero damage", async () => {
    const { tx } = createTx();
    mockRandom([0]);

    const result = await resolveAttack(tx);

    expect(result.combat_facts.damage).toBe(0);
    expect(tx.encounter.update).not.toHaveBeenCalled();
  });

  it("loads campaign.characterId and the wearer's armour on one read", async () => {
    // The select grew: `actorArmorPenalty` needs the player's class and
    // inventory, and this is the read that already fetches the campaign's
    // character, so the penalty costs no extra query. The original assertion —
    // that characterId is loaded — is unchanged; the two new keys are added to
    // it rather than replacing it.
    const { tx } = createTx({ characterId: "character-1" });
    mockRandom([0.5, 0.5, 0.3]);

    await resolveAttack(tx);

    expect(tx.campaign.findUnique).toHaveBeenCalledWith({
      where: { id: "campaign-1" },
      select: {
        characterId: true,
        character: { select: { class: true, inventory: true } },
      },
    });
  });

  it("rejects a missing active encounter", async () => {
    const { tx } = createTx({ encounter: null });

    await expect(resolveAttack(tx)).rejects.toMatchObject({
      code: "ENCOUNTER_NOT_FOUND",
    });
  });

  it("rejects a missing attacker combatant", async () => {
    const { tx } = createTx();

    await expect(resolveAttack(tx, { attackerId: "missing-attacker" })).rejects.toMatchObject({
      code: "ATTACKER_NOT_FOUND",
    });
  });

  it("rejects a missing target combatant", async () => {
    const { tx } = createTx();

    await expect(resolveAttack(tx, { targetId: "missing-target" })).rejects.toMatchObject({
      code: "TARGET_NOT_FOUND",
    });
  });

});

/**
 * `buildAttackPayload` is the second producer of `CombatActionPayload`, and
 * `actorArmorPenalty` is optional with a `false` default at
 * `combat-pipeline.ts:330`. Omitting it here would type-check, keep every other
 * test green, and let every attack routed through `resolveCombatAttack` escape
 * the penalty. These are the tests that would fail if it were dropped again.
 */
describe("resolveCombatAttack carries the armour penalty to the die", () => {
  const HEAVY_ARMOR: ArmorInventoryRow[] = [
    {
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
    },
  ];

  /** First d20 near-max, second near-min: normal crits, disadvantage fumbles. */
  const HIGH_THEN_LOW = [0.99, 0, 0.5, 0.5, 0.5, 0.5];

  afterEach(() => vi.restoreAllMocks());

  it("rolls with disadvantage for a wizard in heavy armour", async () => {
    const { tx } = createTx({
      character: { class: "wizard", inventory: HEAVY_ARMOR },
    });
    mockRandom(HIGH_THEN_LOW);

    const result = await resolveAttack(tx);

    // The second, lower die is the one that counted.
    expect(result.combat_facts.is_crit).toBe(false);
    expect(result.combat_facts.is_fumble).toBe(true);
  });

  it("rolls normally for a fighter in the same armour", async () => {
    const { tx } = createTx({
      character: { class: "fighter", inventory: HEAVY_ARMOR },
    });
    mockRandom(HIGH_THEN_LOW);

    const result = await resolveAttack(tx);

    // Only one die was rolled, and it was the high one.
    expect(result.combat_facts.is_crit).toBe(true);
    expect(result.combat_facts.is_fumble).toBe(false);
  });

  it("rolls normally when the campaign has no character to read", async () => {
    const { tx } = createTx();
    mockRandom(HIGH_THEN_LOW);

    const result = await resolveAttack(tx);

    expect(result.combat_facts.is_crit).toBe(true);
  });
});
