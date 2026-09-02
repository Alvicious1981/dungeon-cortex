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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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
import { seededFloat } from "@/lib/rules/generators";
import type { Prisma } from "@prisma/client";
import type { SingleTargetConsequence } from "@/lib/events/game-events";
import {
  buildEncounter,
  buildEnemy,
  buildMockTx,
  buildPlayer,
} from "./combat-pipeline-fixtures";

/**
 * `grantLoot` is mocked so these assertions cover what the pipeline *asks
 * for*, not what the loot table produces. The service's own behaviour —
 * deterministic generation from the encounter seed, the atomic gold
 * increment — is covered in tests/rules/loot-service-contract.test.ts.
 */
const grantLootMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rules/loot-service", () => ({
  grantLoot: grantLootMock,
  LootServiceError: class extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
}));

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

    // ── actorArmorPenalty wiring (Hop B: CombatActionPayload → computeConsequences) ──
    //
    // executeCombatAction does not surface `disadvantage` directly, so these
    // tests observe its effect on which physical d20 the pipeline reports as
    // `naturalRoll`. The random queue supplies a high value then a low value:
    // under disadvantage two d20s are rolled and the lower is kept (the
    // second, queued value); without it, only the first (high) roll is ever
    // consumed. A wiring break between actorArmorPenalty and computeConsequences
    // would make the penalised case report the high roll instead.

    it("actorArmorPenalty: true forces the attack roll onto disadvantage", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // d20 (Dis): 0.9 → 19, 0.05 → 2; lower (2) is kept, so the attack misses AC 10.
      mockRandom([0.9, 0.05]);

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        actorArmorPenalty: true,
        targetCombatants: [enemy],
        weaponName: "Dagger",
        weaponDice: "1d4",
        damageType: "piercing",
        attackModifier: 0,
        flatDamageBonus: 0,
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.consequences[0]?.naturalRoll).toBe(2);
    });

    it("without actorArmorPenalty, the attack roll is a single unpenalised d20", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      // Same queue as above, but with no disadvantage only the first roll (19) is consumed.
      mockRandom([0.9, 0.05]);

      const payload: CombatActionPayload = {
        actionType: "attack",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        // actorArmorPenalty intentionally absent — no armour penalty applies.
        targetCombatants: [enemy],
        weaponName: "Dagger",
        weaponDice: "1d4",
        damageType: "piercing",
        attackModifier: 0,
        flatDamageBonus: 0,
        collectEvents: true,
      };

      const outcome = await executeCombatAction(payload, tx);

      expect(outcome.consequences[0]?.naturalRoll).toBe(19);
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
      expect(tx.combatant.update).toHaveBeenCalledWith({
        where: { id: "player-1" },
        data: { concentrationSpellId: "Bless" },
      });
      expect(outcome.events.some((e) => e.type === "CONCENTRATION_STARTED")).toBe(true);
      const concEvent = outcome.events.find((e) => e.type === "CONCENTRATION_STARTED");
      expect(concEvent?.payload.spellName).toBe("Bless");
    });

    it("replaces concentration atomically and emits break before start", async () => {
      const player = buildPlayer({ concentrationSpellId: "Bless" });
      const tx = buildMockTx();
      const outcome = await executeCombatAction({
        actionType: "cast_spell",
        encounter: buildEncounter([player]),
        actorId: player.id,
        actorName: player.name,
        actorConditions: [],
        targetCombatants: [],
        spellName: "Haste",
        spellLevel: 3,
        spellEffect: { type: "utility", concentration: true },
        rawSpellSlots: { "3": { current: 1, max: 1 } },
        playerCharacterId: "char-1",
        actorConcentrationSpellId: "Bless",
        collectEvents: true,
      }, tx);

      expect(tx.character.update).toHaveBeenCalledWith({
        where: { id: "char-1" },
        data: { concentrationSpellId: "Haste" },
      });
      expect(tx.combatant.update).toHaveBeenCalledWith({
        where: { id: player.id },
        data: { concentrationSpellId: "Haste" },
      });
      expect(outcome.events.map((event) => event.type)).toEqual([
        "SPELL_CAST",
        "CONCENTRATION_BROKEN",
        "CONCENTRATION_STARTED",
      ]);
      const broken = outcome.events.find(
        (event) => event.type === "CONCENTRATION_BROKEN"
      );
      expect(broken?.payload).toMatchObject({
        spellName: "Bless",
        reason: "replaced",
      });
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

      const slotUpdate = (tx.character.update as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0].data?.spellSlots !== undefined
      );
      expect(slotUpdate).toBeUndefined();
      const spellCast = outcome.events.find((event) => event.type === "SPELL_CAST");
      expect(spellCast?.payload.slotConsumed).toBe(false);

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

    it("deals no damage when the SRD save outcome is none", async () => {
      const enemy = buildEnemy();
      const tx = buildMockTx();
      mockRandom([0.95, 0.99]);

      const outcome = await executeCombatAction({
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        spellName: "Acid Splash",
        spellLevel: 0,
        spellEffect: {
          type: "damage",
          dice: "1d6",
          hasSavingThrow: true,
          saveAbility: "DEX",
          saveDamage: "none",
          damageType: "acid",
        },
        spellSaveDC: 15,
        collectEvents: true,
      }, tx);

      expect(outcome.totalDamageDealt).toBe(0);
      expect(outcome.consequences[0]).toMatchObject({
        damage: 0,
        hpAfter: enemy.hp,
      });
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
    it("builds a targets-only COMBAT_CONSEQUENCE payload", () => {
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

      expect(event).toEqual({
        type: "COMBAT_CONSEQUENCE",
        payload: { attackerName: "Aldric", targets: [target] },
      });
      expect(Object.keys(event.payload).sort()).toEqual(["attackerName", "targets"]);
    });

    it("preserves an empty canonical targets array", () => {
      const event = buildCombatConsequenceEvent({ attackerName: "Aldric", targets: [] });

      expect(event).toEqual({
        type: "COMBAT_CONSEQUENCE",
        payload: { attackerName: "Aldric", targets: [] },
      });
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

  it("takes the winner path (claim.count === 1) and marks encounter as resolved when all enemies are dead", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 15 },
      { id: "enemy-1", isPlayer: false, hp: 0 },
    ]);
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: false,
    });

    expect(result.encounterResolved).toBe(true);
    expect(tx.encounter.updateMany).toHaveBeenCalledWith({
      where: { id: "enc-1", status: "active" },
      data: { status: "resolved" },
    });
    expect(tx.encounter.update).not.toHaveBeenCalled();
  });

  it("marks encounter as resolved when the player is dead, and never grants XP even though an enemy carries a positive xpValue", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 0 },
      { id: "enemy-1", isPlayer: false, hp: 10, xpValue: 50 },
    ]);

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
    });

    expect(result.encounterResolved).toBe(true);
    // player_dead never reaches the award evaluation, regardless of xpValue.
    expect(tx.encounter.findUnique).not.toHaveBeenCalled();
    expect(tx.character.update).not.toHaveBeenCalled();
  });

  describe("XP award (docs/DECISION_XP_AWARD_AUTHORITY.md)", () => {
    it("grants the exact sum of enemy xpValue via an atomic increment, never an absolute value, when all enemies are dead", async () => {
      const tx = buildMockTx();
      (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
        { id: "enemy-2", isPlayer: false, hp: 0, xpValue: 25 },
      ]);

      const result = await finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      expect(result.encounterResolved).toBe(true);
      // Recipient derived from Encounter → Campaign → characterId, never a
      // client/AI/combatant-supplied id.
      expect(tx.encounter.findUnique).toHaveBeenCalledWith({
        where: { id: "enc-1" },
        select: { campaign: { select: { characterId: true } } },
      });
      // Exact shape: an atomic `increment`, nothing else in `data` — never
      // `xp: <computed absolute number>`, and `level` is never touched.
      expect(tx.character.update).toHaveBeenCalledWith({
        where: { id: "char-1" },
        data: { xp: { increment: 75 } },
      });
    });

    it("treats a single enemy missing xpValue as fail-closed: total 0, no partial award", async () => {
      const tx = buildMockTx();
      (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
        { id: "enemy-2", isPlayer: false, hp: 0, xpValue: null },
      ]);

      const result = await finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      expect(result.encounterResolved).toBe(true);
      // The 50 from enemy-1 is never paid out just because enemy-2 is unrated.
      expect(tx.character.update).not.toHaveBeenCalled();
    });

    it("treats xpValue: 0 as a valid, non-unavailable amount and sums it normally", async () => {
      const tx = buildMockTx();
      (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
        { id: "enemy-2", isPlayer: false, hp: 0, xpValue: 0 },
      ]);

      const result = await finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      expect(result.encounterResolved).toBe(true);
      // xpValue: 0 is not "unavailable" — it contributes 0, it does not zero
      // the whole encounter the way xpValue: null does above.
      expect(tx.character.update).toHaveBeenCalledWith({
        where: { id: "char-1" },
        data: { xp: { increment: 50 } },
      });
    });

    it("resolves normally without touching Character.xp when the total award is exactly 0", async () => {
      const tx = buildMockTx();
      (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 0 },
      ]);

      const result = await finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      expect(result.encounterResolved).toBe(true);
      expect(tx.character.update).not.toHaveBeenCalled();
    });

    it("grants independent increments across two distinct awards without reconstructing XP from a prior snapshot", async () => {
      const firstTx = buildMockTx();
      (firstTx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 40 },
      ]);

      await finalizeEncounterTurn({
        tx: firstTx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      const secondTx = buildMockTx();
      (secondTx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 15 },
      ]);

      await finalizeEncounterTurn({
        tx: secondTx,
        encounterId: "enc-2",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      // Each award is an independent `increment` call scoped to its own
      // transaction — neither reads nor depends on the other's outcome.
      expect(firstTx.character.update).toHaveBeenCalledWith({
        where: { id: "char-1" },
        data: { xp: { increment: 40 } },
      });
      expect(secondTx.character.update).toHaveBeenCalledWith({
        where: { id: "char-1" },
        data: { xp: { increment: 15 } },
      });
    });
  });

  describe("loot award", () => {
    beforeEach(() => {
      grantLootMock.mockReset();
      grantLootMock.mockResolvedValue({ ok: true, gold: 12, items: [], facts: {} });
    });

    /**
     * The victory prompt has always told the narrator that "Loot, XP, and
     * state changes are resolved by the backend action pipeline". XP was; loot
     * was not, and nothing else granted it either — the only way to gain an
     * item or gold in the game was to buy it. An instruction about a fact that
     * never arrives is an invitation to invent one.
     */
    it("grants loot on a certified victory, on the same claim that grants XP", async () => {
      const tx = buildMockTx();
      (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
      ]);

      await finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      expect(grantLootMock).toHaveBeenCalledTimes(1);
      // tensionScore, not an explicit gold/items figure: that is the service's
      // deterministic branch, seeded on the encounter id. Passing numbers here
      // would be inventing mechanics at the call site.
      expect(grantLootMock).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: "camp-1",
          encounterId: "enc-1",
          // Pinned to the derivation, not merely "some number": `Encounter`
          // has no tensionScore column, so the same encounter must keep
          // paying the same loot on any replay.
          tensionScore: seededFloat("enc-1:tension"),
          tx,
        }),
      );
      const call = grantLootMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(call.gold).toBeUndefined();
      expect(call.items).toBeUndefined();
    });

    it("never grants loot when the player is dead, the way XP is withheld", async () => {
      const tx = buildMockTx();
      (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 0 },
        { id: "enemy-1", isPlayer: false, hp: 12, xpValue: 50 },
      ]);

      await finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      expect(grantLootMock).not.toHaveBeenCalled();
    });

    /**
     * The service has no idempotency guard of its own. It does not need one
     * here: it is called inside `claim.count === 1`, and the conditional
     * `updateMany` claim is what makes the whole reward path once-only. A
     * second transaction matches zero rows and never reaches this code.
     */
    it("does not pay twice when a second transaction loses the claim", async () => {
      const secondTx = buildMockTx();
      (secondTx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
      ]);
      (secondTx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      await finalizeEncounterTurn({
        tx: secondTx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      expect(grantLootMock).not.toHaveBeenCalled();
    });

    it("resolves the encounter even when the loot grant fails", async () => {
      const tx = buildMockTx();
      (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "player-1", isPlayer: true, hp: 15 },
        { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
      ]);
      grantLootMock.mockRejectedValueOnce(new Error("loot table unavailable"));

      const result = await finalizeEncounterTurn({
        tx,
        encounterId: "enc-1",
        currentTurnIndex: 0,
        round: 1,
        collectEvents: false,
      });

      // Both halves, or the test proves nothing: without the call the queued
      // rejection never fires and "survives a loot failure" is vacuous.
      expect(grantLootMock).toHaveBeenCalledTimes(1);
      expect(result.encounterResolved).toBe(true);
    });
  });

  it("takes the fail-closed path (claim.count === 0) without throwing when another transaction already won the claim, and never grants XP", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 15 },
      { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
    ]);
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: false,
    });

    // The encounter is still mechanically resolved from the caller's point of
    // view, but this transaction never reached the count === 1 winner branch —
    // the only branch the award producer may run in — so the 50 xpValue on
    // enemy-1 is never paid out.
    expect(result.encounterResolved).toBe(true);
    expect(tx.encounter.updateMany).toHaveBeenCalledWith({
      where: { id: "enc-1", status: "active" },
      data: { status: "resolved" },
    });
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(tx.encounter.findUnique).not.toHaveBeenCalled();
    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("takes the fail-closed path for any claim.count other than exactly 1, and never grants XP", async () => {
    const tx = buildMockTx();
    (tx.combatant.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "player-1", isPlayer: true, hp: 15 },
      { id: "enemy-1", isPlayer: false, hp: 0, xpValue: 50 },
    ]);
    // Defensive case: an unexpected match count must not be treated as a win.
    (tx.encounter.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });

    const result = await finalizeEncounterTurn({
      tx,
      encounterId: "enc-1",
      currentTurnIndex: 0,
      round: 1,
      collectEvents: false,
    });

    expect(result.encounterResolved).toBe(true);
    expect(tx.character.update).not.toHaveBeenCalled();
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
    expect(tx.encounter.updateMany).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// executeCombatAction — spell damage against the target's modifiers
// ---------------------------------------------------------------------------

/** A resistant/vulnerable-capable enemy fixture for the modifier tests below. */
function enemyFixture(): PipelineCombatant {
  return buildEnemy({ id: "fireball-target", name: "Fire Elemental" });
}

/**
 * Drives the real `cast_spell` branch of `executeCombatAction` with a single
 * fire-damage effect and a deterministic die roll, so `opts.rolledDamage` is
 * exactly what `roll(effect.dice)` returns before any modifier is applied.
 *
 * `Math.random` is pinned to 0 so the one `1d2` die always comes up 1; the
 * notation's flat modifier then makes up the rest of `rolledDamage`.
 */
async function castFireballAt(
  target: PipelineCombatant,
  opts: { rolledDamage: number }
): Promise<{ combatants: PipelineCombatant[]; systemLogs: string[] }> {
  const restore = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    const tx = buildMockTx();
    const payload: CombatActionPayload = {
      actionType: "cast_spell",
      encounter: buildEncounter([buildPlayer(), target]),
      actorId: "player-1",
      actorName: "Aldric",
      actorConditions: [],
      targetCombatants: [target],
      spellName: "Fireball",
      spellEffect: {
        type: "damage",
        dice: `1d2+${opts.rolledDamage - 1}`,
        damageType: "fire",
        hasSavingThrow: false,
      },
      collectEvents: true,
    };

    const outcome = await executeCombatAction(payload, tx as unknown as Prisma.TransactionClient);
    const consequence = outcome.consequences.find((c) => c.targetId === target.id);

    return {
      combatants: [{ ...target, hp: consequence?.hpAfter ?? target.hp }],
      systemLogs: outcome.systemLogs,
    };
  } finally {
    restore.mockRestore();
  }
}

function systemLogLines(result: { systemLogs: string[] }): string[] {
  return result.systemLogs;
}

describe("executeCombatAction — spell damage resolves against modifiers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("halves spell damage against a resistant target", async () => {
    const target = { ...enemyFixture(), hp: 50, damageResistances: ["fire"] };
    const result = await castFireballAt(target, { rolledDamage: 10 });

    expect(result.combatants.find((c) => c.id === target.id)!.hp).toBe(45);
  });

  it("resolves a weapon clause as inapplicable to spell damage, silently", async () => {
    // This case used to write "not applied": the clause was unreadable, so the
    // engine declared the gap. It is readable now, and a spell is not a weapon,
    // so the answer is "does not apply" — a resolution, not a refusal. Declaring
    // a refusal that no longer happened would be its own kind of lie.
    const clause = "bludgeoning, piercing, and slashing from nonmagical weapons";
    const target = { ...enemyFixture(), hp: 50, damageResistances: [clause] };
    const result = await castFireballAt(target, { rolledDamage: 10 });

    expect(result.combatants.find((c) => c.id === target.id)!.hp).toBe(40);
    expect(systemLogLines(result).some((line) => line.includes("not applied"))).toBe(false);
  });

  it("still logs a wording the engine cannot read", async () => {
    // The declared-refusal guarantee survives for everything outside the table.
    const clause = "piercing from magic weapons wielded by good creatures";
    const target = { ...enemyFixture(), hp: 50, damageResistances: [clause] };
    const result = await castFireballAt(target, { rolledDamage: 10 });

    expect(result.combatants.find((c) => c.id === target.id)!.hp).toBe(40);
    expect(systemLogLines(result).some((line) => line.includes("not applied"))).toBe(true);
  });
});

describe("condition immunity", () => {
  // SrdMonster.conditionImmunities was written by both seeders and read by no
  // rule. The chain this covers: the column reaches PipelineCombatant, the
  // spell branch filters the attempted condition against it, and the facts,
  // the persisted row and the system log all come from the same split.
  function poisonPayload(target: PipelineCombatant): CombatActionPayload {
    return {
      actionType: "cast_spell",
      encounter: buildEncounter([buildPlayer(), target]),
      actorId: "player-1",
      actorName: "Mira",
      actorConditions: [],
      targetCombatants: [target],
      spellName: "Ray of Sickness",
      spellLevel: 1,
      spellEffect: {
        type: "damage",
        dice: "1d6",
        hasSavingThrow: false,
        condition: "poisoned",
      },
      playerCharacterId: "char-1",
      collectEvents: true,
    };
  }

  it("applies the condition to a target with no immunities", async () => {
    const tx = buildMockTx();
    const target = buildEnemy({ conditionImmunities: [] });

    const outcome = await executeCombatAction(poisonPayload(target), tx as never);

    expect(tx.combatant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ conditions: ["poisoned"] }),
      })
    );
    expect(outcome.consequences[0]?.conditionsApplied).toEqual(["poisoned"]);
    expect(outcome.systemLogs).toEqual([]);
  });

  it("does not write the condition onto an immune target", async () => {
    const tx = buildMockTx();
    const target = buildEnemy({ conditionImmunities: ["poisoned"] });

    await executeCombatAction(poisonPayload(target), tx as never);

    expect(tx.combatant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ conditions: [] }),
      })
    );
  });

  it("tells the facts the truth about what took hold", async () => {
    // `combat_facts.status_applied` is set from the filtered `granted` list on
    // this path too, which is correct — but nothing downstream reads it for a
    // cast_spell action: consequenceDetails.push only happens in the attack
    // branch, and this spell branch's facts are consumed solely by
    // deriveNarrativeTags, which never looks at status_applied. The real,
    // narrator-facing assertion is the one below.
    const tx = buildMockTx();
    const target = buildEnemy({ conditionImmunities: ["poisoned"] });

    const outcome = await executeCombatAction(poisonPayload(target), tx as never);

    expect(outcome.consequences[0]?.conditionsApplied).toEqual([]);
  });

  it("declares the immunity in the system log", async () => {
    const tx = buildMockTx();
    const target = buildEnemy({ conditionImmunities: ["poisoned"] });

    const outcome = await executeCombatAction(poisonPayload(target), tx as never);

    expect(outcome.systemLogs.some((line) => /immune/i.test(line))).toBe(true);
    expect(outcome.systemLogs.some((line) => line.includes("poisoned"))).toBe(true);
  });

  it("still applies damage to an immune target", async () => {
    // Immunity to a condition is not immunity to the spell.
    const tx = buildMockTx();
    const target = buildEnemy({ hp: 20, conditionImmunities: ["poisoned"] });

    await executeCombatAction(poisonPayload(target), tx as never);

    const call = (tx.combatant.update as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.at(-1)?.[0] as { data: { hp: number } };
    expect(call.data.hp).toBeLessThan(20);
  });
});
