/**
 * tests/rules/combat-pipeline.test.ts
 *
 * Deterministic fail-fast suite for lib/rules/combat-pipeline.ts.
 * All DB access is mocked via a synthetic Prisma.TransactionClient.
 * All dice randomness is controlled via Math.random mocking so every
 * assertion covers a deterministic, reproducible outcome.
 *
 * Coverage contract (SPECIFICATION CONTRACT):
 *   1. Resource Drain Assurance — spell slots decrement; items delete/update;
 *      zero mutations when resources are exhausted.
 *   2. Concentration Fidelity — start, break (CON fail → both Combatant +
 *      Character updated atomically), and preserve (CON pass → no mutation).
 *   3. Healing Bounds — never exceed maxHp for spells or items.
 *   4. Event Emission — DAMAGE_DEALT, CRITICAL_HIT, CRITICAL_MISS,
 *      ENEMY_DEFEATED, SPELL_CAST, CONCENTRATION_STARTED,
 *      CONCENTRATION_BROKEN, HEALING_RECEIVED.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  executeCombatAction,
  finalizeEncounterTurn,
  buildCombatConsequenceEvent,
} from "@/lib/rules/combat-pipeline";
import type {
  CombatActionPayload,
  PipelineCombatant,
  PipelineEncounterState,
} from "@/lib/rules/combat-pipeline";
import type { Prisma } from "@/app/generated/prisma/client";
import type { SingleTargetConsequence } from "@/lib/events/game-events";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/**
 * Queue Math.random return values so dice rolls are deterministic.
 * Any call beyond the queue returns 0.5 as a safe fallback.
 *
 * Die result formula: Math.floor(Math.random() * faces) + 1
 *   d20 → value N: random = (N-1)/20   e.g. roll 11: 0.5, roll 20: 0.95, roll 1: 0.0
 *   d8  → value 8: random = 0.99       (floor(0.99*8)+1 = 8)
 *   d6  → value 6: random = 0.99       (floor(0.99*6)+1 = 6)
 *   d4  → value 4: random = 0.99       (floor(0.99*4)+1 = 4)
 *   d4  → value 3: random = 0.5        (floor(0.50*4)+1 = 3)
 *
 * Hit-location (10 entries, index):
 *   "head"=0, "neck"=1, "shoulder"=2, "chest"=3, "abdomen"=4,
 *   "arm"=5,  "hand"=6, "leg"=7,     "knee"=8,  "foot"=9
 *   → index I: random = I/10          e.g. "head": 0.0, "chest": 0.3
 */
function mockRandom(values: number[]): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => values[i++] ?? 0.5);
}

/** Build a minimal mock Prisma.TransactionClient with vi.fn() on every method
 *  used by the pipeline. Override characterHp / characterMaxHp to test healing. */
function buildMockTx(opts: { characterHp?: number; characterMaxHp?: number } = {}) {
  const { characterHp = 20, characterMaxHp = 20 } = opts;
  return {
    character: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({
        id: "char-1",
        hp: characterHp,
        maxHp: characterMaxHp,
        concentrationSpellId: null,
      }),
    },
    combatant: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    encounter: {
      update: vi.fn().mockResolvedValue({}),
    },
    inventoryItem: {
      delete: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Prisma.TransactionClient;
}

function buildEnemy(overrides: Partial<PipelineCombatant> = {}): PipelineCombatant {
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

function buildPlayer(overrides: Partial<PipelineCombatant> = {}): PipelineCombatant {
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

function buildEncounter(combatants: PipelineCombatant[]): PipelineEncounterState {
  return {
    id: "enc-1",
    round: 1,
    currentTurnIndex: 0,
    totalDamageDealt: 0,
    status: "active",
    combatants,
  };
}

// ---------------------------------------------------------------------------
// executeCombatAction — attack
// ---------------------------------------------------------------------------

describe("executeCombatAction", () => {
  afterEach(() => vi.restoreAllMocks());

  // ── Attack ──────────────────────────────────────────────────────────────────

  describe("attack action", () => {
    it("updates combatant HP and emits DAMAGE_DEALT on a normal hit", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // d20: 0.5 → roll 11, hits AC 10 (normal hit)
      // 1d4 damage: 0.5 → floor(0.5*4)+1 = 3
      // hit-location: 0.3 → floor(0.3*10) = 3 → "chest"
      mockRandom([0.5, 0.5, 0.3]);

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        weaponName: "Dagger",
        weaponDice: "1d4",
        damageType: "piercing",
        attackModifier: 0,
        flatDamageBonus: 0,
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.totalDamageDealt).toBe(3);
      expect(outcome.consequences[0]?.damage).toBe(3);
      expect(outcome.consequences[0]?.hpAfter).toBe(12); // 15 - 3
      expect(tx.combatant.update).toHaveBeenCalledWith({
        where: { id: "enemy-1" },
        data: { hp: 12, conditions: [] },
      });
      expect(outcome.events.some((e) => e.type === "DAMAGE_DEALT")).toBe(true);
    });

    it("emits CRITICAL_HIT on a natural 20 and rolls double dice", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // d20: 0.95 → floor(0.95*20)+1 = 20 — critical!
      // 2d4 (crit doubles dice): both 0.99 → 4 each = 8 total
      // hit-location: 0.3 → "chest"
      mockRandom([0.95, 0.99, 0.99, 0.3]);

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        weaponName: "Dagger",
        weaponDice: "1d4",
        damageType: "piercing",
        attackModifier: 0,
        flatDamageBonus: 0,
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.totalDamageDealt).toBe(8);
      expect(outcome.consequences[0]?.isCrit).toBe(true);
      const critEvent = outcome.events.find((e) => e.type === "CRITICAL_HIT");
      expect(critEvent).toBeDefined();
      expect(critEvent?.payload.damage).toBe(8);
    });

    it("emits CRITICAL_MISS on a natural 1 and deals zero damage", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // d20: 0.0 → floor(0*20)+1 = 1 — fumble
      mockRandom([0.0]);

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        weaponName: "Dagger",
        weaponDice: "1d4",
        damageType: "piercing",
        attackModifier: 0,
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.totalDamageDealt).toBe(0);
      expect(outcome.consequences[0]?.isFumble).toBe(true);
      expect(outcome.events.some((e) => e.type === "CRITICAL_MISS")).toBe(true);
      expect(outcome.events.some((e) => e.type === "DAMAGE_DEALT")).toBe(false);
      // HP unchanged — combatant still gets an update (damage=0, conditions unchanged)
      expect(tx.combatant.update).toHaveBeenCalledWith({
        where: { id: "enemy-1" },
        data: { hp: 15, conditions: [] },
      });
    });

    it("emits ENEMY_DEFEATED when target HP reaches zero", async () => {
      const enemy = buildEnemy({ hp: 3, maxHp: 15 });
      const tx = buildMockTx();
      // d20: 0.5 → 11 (hits AC 10); 1d4: 0.99 → 4 (overkill); hit-loc: 0.3
      mockRandom([0.5, 0.99, 0.3]);

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        weaponName: "Dagger",
        weaponDice: "1d4",
        damageType: "piercing",
        attackModifier: 0,
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.consequences[0]?.isKill).toBe(true);
      expect(outcome.consequences[0]?.hpAfter).toBe(0);
      expect(outcome.events.some((e) => e.type === "ENEMY_DEFEATED")).toBe(true);
    });

    it("increments encounter totalDamageDealt when damage > 0", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      mockRandom([0.5, 0.5, 0.3]); // hit, damage=3

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        weaponName: "Dagger",
        weaponDice: "1d4",
        damageType: "piercing",
        attackModifier: 0,
      };

      await executeCombatAction(payload, tx);

      expect(tx.encounter.update).toHaveBeenCalledWith({
        where: { id: "enc-1" },
        data: { totalDamageDealt: { increment: 3 } },
      });
    });

    it("does not update encounter totalDamageDealt on a fumble (zero damage)", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      mockRandom([0.0]); // fumble

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        weaponName: "Dagger",
        weaponDice: "1d4",
        damageType: "piercing",
        attackModifier: 0,
      };

      await executeCombatAction(payload, tx);

      expect(tx.encounter.update).not.toHaveBeenCalled();
    });
  });

  // ── Resource drain — spell slots ─────────────────────────────────────────────

  describe("resource drain — spell slots", () => {
    it("decrements the consumed slot and persists it to Character", async () => {
      const tx = buildMockTx({ characterHp: 10, characterMaxHp: 20 });
      // roll("1d8") for healing: 0.5 → floor(0.5*8)+1 = 5
      mockRandom([0.5]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        spellName: "Cure Wounds",
        spellLevel: 1,
        spellEffect: { type: "healing", dice: "1d8" },
        rawSpellSlots: { "1": { current: 2, max: 4 } },
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      await executeCombatAction(payload, tx);

      // First character.update must be the slot decrement (before healing update)
      const allUpdateCalls = (tx.character.update as ReturnType<typeof vi.fn>).mock.calls;
      const slotUpdateCall = allUpdateCalls.find((c) => c[0].data?.spellSlots !== undefined);
      expect(slotUpdateCall).toBeDefined();
      expect(slotUpdateCall![0].data.spellSlots).toMatchObject({
        "1": { current: 1, max: 4 },
      });
    });

    it("emits SPELL_CAST event with level and name when slot is consumed", async () => {
      const tx = buildMockTx({ characterHp: 10, characterMaxHp: 20 });
      mockRandom([0.5]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        spellName: "Cure Wounds",
        spellLevel: 1,
        spellEffect: { type: "healing", dice: "1d8" },
        rawSpellSlots: { "1": { current: 2, max: 4 } },
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      const spellCastEvent = outcome.events.find((e) => e.type === "SPELL_CAST");
      expect(spellCastEvent).toBeDefined();
      expect(spellCastEvent?.payload.spellLevel).toBe(1);
      expect(spellCastEvent?.payload.spellName).toBe("Cure Wounds");
    });

    it("throws and makes ZERO database mutations when no spell slots remain", async () => {
      const tx = buildMockTx();
      mockRandom([]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        spellName: "Fireball",
        spellLevel: 3,
        spellEffect: { type: "damage", dice: "8d6", hasSavingThrow: true, saveAbility: "DEX" },
        rawSpellSlots: { "3": { current: 0, max: 2 } },
        playerCharacterId: "char-1",
      };

      await expect(executeCombatAction(payload, tx)).rejects.toThrow(
        /No available spell slots remaining at level 3/
      );

      // Asserts zero state mutation
      expect(tx.character.update).not.toHaveBeenCalled();
      expect(tx.combatant.update).not.toHaveBeenCalled();
      expect(tx.encounter.update).not.toHaveBeenCalled();
      expect(tx.inventoryItem.update).not.toHaveBeenCalled();
      expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
    });
  });

  // ── Resource drain — items ────────────────────────────────────────────────────

  describe("resource drain — items", () => {
    it("decrements item quantity when quantity > 1 (not last charge)", async () => {
      const tx = buildMockTx({ characterHp: 10, characterMaxHp: 20 });
      // 1d4 healing + bonus 2: 0.5 → roll 3, heal = 5
      mockRandom([0.5]);

      const payload: CombatActionPayload = {
        actionType: "use_item",
        encounter: buildEncounter([buildPlayer()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        itemId: "item-1",
        itemName: "Healing Potion",
        itemQuantity: 3,
        healingDice: "1d4",
        healingBonus: 2,
        playerCharacterId: "char-1",
      };

      await executeCombatAction(payload, tx);

      expect(tx.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: "item-1" },
        data: { quantity: 2 },
      });
      expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
    });

    it("deletes the item record when quantity is 1 (last charge consumed)", async () => {
      const tx = buildMockTx({ characterHp: 10, characterMaxHp: 20 });
      mockRandom([0.5]);

      const payload: CombatActionPayload = {
        actionType: "use_item",
        encounter: buildEncounter([buildPlayer()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        itemId: "item-1",
        itemName: "Healing Potion",
        itemQuantity: 1,
        healingDice: "1d4",
        healingBonus: 2,
        playerCharacterId: "char-1",
      };

      await executeCombatAction(payload, tx);

      expect(tx.inventoryItem.delete).toHaveBeenCalledWith({ where: { id: "item-1" } });
      expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    });
  });

  // ── Healing bounds ────────────────────────────────────────────────────────────

  describe("healing bounds", () => {
    it("caps spell healing at maxHp — never writes a value above maxHp", async () => {
      // hp=18, maxHp=20: 1d8 → 8 would yield 26 but must be capped at 20
      const tx = buildMockTx({ characterHp: 18, characterMaxHp: 20 });
      // 1d8: 0.99 → floor(0.99*8)+1 = 8
      mockRandom([0.99]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        spellName: "Cure Wounds",
        spellLevel: 1,
        spellEffect: { type: "healing", dice: "1d8" },
        rawSpellSlots: { "1": { current: 2, max: 4 } },
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      const hpUpdateCall = (tx.character.update as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0].data?.hp !== undefined
      );
      expect(hpUpdateCall).toBeDefined();
      expect(hpUpdateCall![0].data.hp).toBe(20); // capped, NOT 26

      const healingEvent = outcome.events.find((e) => e.type === "HEALING_RECEIVED");
      expect(healingEvent).toBeDefined();
      expect(healingEvent?.payload.newHp).toBe(20);
    });

    it("caps item healing at maxHp — never writes a value above maxHp", async () => {
      // hp=17, maxHp=20: 1d4→4 + bonus 2 = 6 → would be 23, must be capped at 20
      const tx = buildMockTx({ characterHp: 17, characterMaxHp: 20 });
      // 1d4: 0.99 → 4
      mockRandom([0.99]);

      const payload: CombatActionPayload = {
        actionType: "use_item",
        encounter: buildEncounter([buildPlayer()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        itemId: "item-2",
        itemName: "Healing Potion",
        itemQuantity: 1,
        healingDice: "1d4",
        healingBonus: 2,
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      const hpUpdateCall = (tx.character.update as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0].data?.hp !== undefined
      );
      expect(hpUpdateCall).toBeDefined();
      expect(hpUpdateCall![0].data.hp).toBe(20); // capped, NOT 23

      const healingEvent = outcome.events.find((e) => e.type === "HEALING_RECEIVED");
      expect(healingEvent).toBeDefined();
    });
  });

  // ── Concentration fidelity ───────────────────────────────────────────────────

  describe("concentration fidelity", () => {
    it("sets concentrationSpellId on Character and emits CONCENTRATION_STARTED when casting a concentration spell", async () => {
      // Bless is a utility concentration spell — no dice, no targets
      const tx = buildMockTx();
      mockRandom([]); // no dice rolls for utility spell with no targets

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer()]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [],
        spellName: "Bless",
        spellLevel: 1,
        spellEffect: { type: "utility", dice: null, concentration: true },
        rawSpellSlots: { "1": { current: 2, max: 4 } },
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(tx.character.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "char-1" },
          data: { concentrationSpellId: "Bless" },
        })
      );
      expect(outcome.events.some((e) => e.type === "CONCENTRATION_STARTED")).toBe(true);
      const concEvent = outcome.events.find((e) => e.type === "CONCENTRATION_STARTED");
      expect(concEvent?.payload.spellName).toBe("Bless");
    });

    it("breaks concentration on both Combatant and Character when CON save fails after damage", async () => {
      // The PLAYER is the target, currently concentrating.
      // Enemy casts a direct damage cantrip; player rolls 9 on a DC 10 CON save → FAIL.
      const playerCombatant = buildPlayer({ concentrationSpellId: "Bless" });
      const tx = buildMockTx({ characterHp: 20, characterMaxHp: 20 });

      // 1d6 damage: 0.99 → 6   →  DC = max(10, floor(6/2)) = 10
      // hit-location: 0.0 → "head"
      // CON save (1d20+0): 0.4 → floor(0.4*20)+1 = 9 < DC 10 → FAIL
      mockRandom([0.99, 0.0, 0.4]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([playerCombatant, buildEnemy()]),
        actorId: "enemy-1",
        actorName: "Goblin",
        actorConditions: [],
        targetCombatants: [playerCombatant],
        spellName: "Toll the Dead",
        spellLevel: 0,
        spellEffect: { type: "damage", dice: "1d6", hasSavingThrow: false },
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      // Combatant row must be cleared
      expect(tx.combatant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "player-1" },
          data: { concentrationSpellId: null },
        })
      );
      // Character row must also be cleared (atomic pair)
      expect(tx.character.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "char-1" },
          data: { concentrationSpellId: null },
        })
      );
      expect(outcome.events.some((e) => e.type === "CONCENTRATION_BROKEN")).toBe(true);
    });

    it("preserves concentration when CON save succeeds", async () => {
      const playerCombatant = buildPlayer({ concentrationSpellId: "Bless" });
      const tx = buildMockTx({ characterHp: 20, characterMaxHp: 20 });

      // 1d6 damage: 0.99 → 6, DC=10
      // hit-location: 0.0
      // CON save (1d20+0): 0.95 → 20 >= DC 10 → PASS
      mockRandom([0.99, 0.0, 0.95]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([playerCombatant, buildEnemy()]),
        actorId: "enemy-1",
        actorName: "Goblin",
        actorConditions: [],
        targetCombatants: [playerCombatant],
        spellName: "Toll the Dead",
        spellLevel: 0,
        spellEffect: { type: "damage", dice: "1d6", hasSavingThrow: false },
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      // concentrationSpellId must NOT have been cleared on either model
      const concClearOnCombatant = (tx.combatant.update as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0].data?.concentrationSpellId === null
      );
      expect(concClearOnCombatant).toBeUndefined();

      expect(tx.character.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { concentrationSpellId: null } })
      );
      expect(outcome.events.some((e) => e.type === "CONCENTRATION_BROKEN")).toBe(false);
    });

    it("does NOT trigger a CON save when the concentrating target takes zero damage", async () => {
      const playerCombatant = buildPlayer({ concentrationSpellId: "Bless" });
      const tx = buildMockTx();
      // Fumble (d20=1) → zero damage, no concentration check
      mockRandom([0.0]);

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([playerCombatant, buildEnemy()]),
        actorId: "enemy-1",
        actorName: "Goblin",
        actorConditions: [],
        targetCombatants: [playerCombatant],
        weaponName: "Club",
        weaponDice: "1d4",
        damageType: "bludgeoning",
        attackModifier: 0,
        collectEvents: true,
        playerCharacterId: "char-1",
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.events.some((e) => e.type === "CONCENTRATION_BROKEN")).toBe(false);
      const concClearCall = (tx.combatant.update as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0].data?.concentrationSpellId === null
      );
      expect(concClearCall).toBeUndefined();
    });
  });

  // ── Spell damage — saving throw path ──────────────────────────────────────────

  describe("cast_spell — saving throw damage", () => {
    it("deals FULL damage on a failed save", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // Target save (DEX, 1d20+0): 0.4 → 9 < DC 15 → FAIL → full damage
      // Damage 1d8: 0.99 → 8 (full, not halved)
      // hit-location: 0.0
      mockRandom([0.4, 0.99, 0.0]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        spellName: "Burning Hands",
        spellLevel: 1,
        spellEffect: {
          type: "damage",
          dice: "1d8",
          hasSavingThrow: true,
          saveAbility: "DEX",
          damageType: "fire",
        },
        spellSaveDC: 15,
        rawSpellSlots: { "1": { current: 2, max: 4 } },
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.totalDamageDealt).toBe(8);
      expect(outcome.consequences[0]?.hpAfter).toBe(7); // 15 - 8
    });

    it("deals HALF damage (floor) on a successful save", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // Target save (DEX, 1d20+0): 0.95 → 20 >= DC 15 → PASS → half damage
      // Damage 1d8: 0.99 → 8 (halved to floor(8/2) = 4)
      // hit-location: 0.0
      mockRandom([0.95, 0.99, 0.0]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        spellName: "Burning Hands",
        spellLevel: 1,
        spellEffect: {
          type: "damage",
          dice: "1d8",
          hasSavingThrow: true,
          saveAbility: "DEX",
          damageType: "fire",
        },
        spellSaveDC: 15,
        rawSpellSlots: { "1": { current: 2, max: 4 } },
        playerCharacterId: "char-1",
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.totalDamageDealt).toBe(4);
      expect(outcome.consequences[0]?.hpAfter).toBe(11); // 15 - 4
    });

    it("applies a status condition to the target on a failed save", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // Save: 0.4 → 9 < DC 15 → FAIL → condition applied
      // Damage 1d8: 0.5 → 5
      // hit-location: 0.0
      mockRandom([0.4, 0.5, 0.0]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        spellName: "Slow",
        spellLevel: 3,
        spellEffect: {
          type: "damage",
          dice: "1d8",
          hasSavingThrow: true,
          saveAbility: "DEX",
          condition: "poisoned",
        },
        spellSaveDC: 15,
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.consequences[0]?.conditionsApplied).toContain("poisoned");
      expect(tx.combatant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "enemy-1" },
          data: expect.objectContaining({
            conditions: expect.arrayContaining(["poisoned"]),
          }),
        })
      );
    });

    it("does NOT apply a condition when the target succeeds on the save", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // Save: 0.95 → 20 >= DC 15 → PASS → no condition
      // Damage 1d8: 0.5 → 5 (halved to 2); hit-location: 0.0
      mockRandom([0.95, 0.5, 0.0]);

      const payload: CombatActionPayload = {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        spellName: "Slow",
        spellLevel: 3,
        spellEffect: {
          type: "damage",
          dice: "1d8",
          hasSavingThrow: true,
          saveAbility: "DEX",
          condition: "poisoned",
        },
        spellSaveDC: 15,
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.consequences[0]?.conditionsApplied).toHaveLength(0);
    });
  });

  // ── buildCombatConsequenceEvent — pure helper ─────────────────────────────────

  describe("buildCombatConsequenceEvent", () => {
    it("builds a COMBAT_CONSEQUENCE event with correct flat fields from the first target", () => {
      const target: SingleTargetConsequence = {
        targetId: "enemy-1",
        targetName: "Goblin",
        damage: 5,
        naturalRoll: 14,
        isCrit: false,
        isFumble: false,
        hitLocation: "chest",
        narrativeTags: ["slash_wound"],
        hpAfter: 10,
        targetMaxHp: 15,
        isKill: false,
        conditionsApplied: [],
      };

      const event = buildCombatConsequenceEvent({ attackerName: "Aldric", targets: [target] });

      expect(event.type).toBe("COMBAT_CONSEQUENCE");
      expect(event.payload.attackerName).toBe("Aldric");
      expect(event.payload.damage).toBe(5);
      expect(event.payload.hpAfter).toBe(10);
      expect(event.payload.isCrit).toBe(false);
      expect(event.payload.isFumble).toBe(false);
      expect(event.payload.isKill).toBe(false);
      expect(event.payload.targetId).toBe("enemy-1");
    });

    it("returns safe zero-value defaults when targets array is empty", () => {
      const event = buildCombatConsequenceEvent({ attackerName: "Aldric", targets: [] });

      expect(event.type).toBe("COMBAT_CONSEQUENCE");
      expect(event.payload.damage).toBe(0);
      expect(event.payload.targetId).toBe("");
      expect(event.payload.targetName).toBe("");
      expect(event.payload.isCrit).toBe(false);
      expect(event.payload.naturalRoll).toBe(0);
    });

    it("populates the full targets array in the payload", () => {
      const target: SingleTargetConsequence = {
        targetId: "e1",
        targetName: "Orc",
        damage: 10,
        naturalRoll: 18,
        isCrit: true,
        isFumble: false,
        hitLocation: "head",
        narrativeTags: [],
        hpAfter: 0,
        targetMaxHp: 10,
        isKill: true,
        conditionsApplied: [],
      };

      const event = buildCombatConsequenceEvent({ attackerName: "Aldric", targets: [target] });

      expect((event.payload.targets as SingleTargetConsequence[])[0]?.isKill).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// finalizeEncounterTurn
// ---------------------------------------------------------------------------

describe("finalizeEncounterTurn", () => {
  afterEach(() => vi.restoreAllMocks());

  it("marks encounter as resolved when all enemies are dead", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 15 },
      { id: "enemy-1", isPlayer: false, hp: 0 },
    ]);

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: false,
    });

    expect(result.encounterResolved).toBe(true);
    expect(tx.encounter.update).toHaveBeenCalledWith({
      where: { id: "enc-1" },
      data: { status: "resolved" },
    });
  });

  it("marks encounter as resolved when the player is dead", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 0 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
    ]);

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
    });

    expect(result.encounterResolved).toBe(true);
  });

  it("advances the turn index and emits TURN_ADVANCE when encounter is ongoing", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 20 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
    ]);

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: true,
    });

    expect(result.encounterResolved).toBe(false);
    expect(result.nextTurnIndex).toBe(1);
    expect(result.nextRound).toBe(1);
    expect(tx.encounter.update).toHaveBeenCalledWith({
      where: { id: "enc-1" },
      data: { currentTurnIndex: 1, round: 1 },
    });
    expect(result.events.some((e) => e.type === "TURN_ADVANCE")).toBe(true);
  });

  it("wraps turn index to 0 and emits ROUND_ADVANCE when the last combatant's turn ends", async () => {
    const tx = buildMockTx();
    // Two combatants: last index is 1
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 20 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
    ]);

    // currentTurnIndex=1 with combatantCount=2 → wraps to 0, round 1 → 2
    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 1,
      round: 1,
      collectEvents: true,
    });

    expect(result.encounterResolved).toBe(false);
    expect(result.nextTurnIndex).toBe(0);
    expect(result.nextRound).toBe(2);
    expect(tx.encounter.update).toHaveBeenCalledWith({
      where: { id: "enc-1" },
      data: { currentTurnIndex: 0, round: 2 },
    });
    expect(result.events.some((e) => e.type === "ROUND_ADVANCE")).toBe(true);
  });

  it("suppresses events when collectEvents is false", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 20 },
      { id: "enemy-1", isPlayer: false, hp: 10 },
    ]);

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: false,
    });

    expect(result.events).toHaveLength(0);
  });
});
