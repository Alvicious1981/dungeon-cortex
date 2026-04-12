import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rollInitiative,
  advanceTurn,
  applyDamage,
  checkDeath,
  resolveEncounterEnd,
  acFromMonsterData,
  acFromInventory,
  resolveAttackRoll,
  // Milestone J — Slice 1
  rollDamage,
  rollHitLocation,
  computeOverkill,
  computeTension,
  deriveNarrativeTags,
  computeNarrativeIntensity,
  deriveCombatBeat,
  deriveStyleDSL,
  selectSenses,
  selectTacticalHooks,
  computeConsequences,
} from "@/lib/rules/combat";
import type {
  CombatFacts,
  TensionState,
  EncounterSnapshot,
  HitLocation,
} from "@/lib/rules/combat";

describe("combat rules", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rollInitiative", () => {
    it("handles empty arrays", () => {
      expect(rollInitiative([]).order).toEqual([]);
    });

    it("sorts by initiative, then mod, then natural roll", () => {
      // Mock random to give specific d20 rolls
      // Order of generation matches the combatants list
      const randomValues = [
        0.5, // 11 -> Player 1 (nat 11 + dex 2 = 13)
        0.5, // 11 -> Player 2 (nat 11 + dex 2 = 13)
        0.6, // 13 -> Enemy 1 (nat 13 + dex 0 = 13)
        0.7, // 15 -> Enemy 2 (nat 15 - dex 2 = 13)
      ];
      let i = 0;
      vi.spyOn(Math, "random").mockImplementation(() => randomValues[i++]);

      // All end up with total initiative 13.
      // Tie breaker 1: Dex mod (highest first)
      // Tie breaker 2: Natural roll (highest first)
      const input = [
        { id: "1", name: "P1", dexModifier: 2 },
        { id: "2", name: "P2", dexModifier: 2 },
        { id: "3", name: "E1", dexModifier: 0 },
        { id: "4", name: "E2", dexModifier: -2 },
      ];

      const { order } = rollInitiative(input);

      // E2: 15 natural, -2 mod => 13
      // E1: 13 natural, 0 mod => 13
      // P1/P2: 11 natural, 2 mod => 13
      
      // Sorted:
      // 1. P1/P2 (dex +2)
      // 2. E1 (dex 0)
      // 3. E2 (dex -2)
      
      expect(order.map(c => c.name)).toEqual(["P1", "P2", "E1", "E2"]);
    });
  });

  describe("advanceTurn", () => {
    it("advances turn index within bounds", () => {
      const result = advanceTurn({ currentTurnIndex: 0, round: 1, combatantCount: 3 });
      expect(result.nextTurnIndex).toBe(1);
      expect(result.nextRound).toBe(1);
      expect(result.roundAdvanced).toBe(false);
    });

    it("wraps properly and increments round", () => {
      const result = advanceTurn({ currentTurnIndex: 2, round: 1, combatantCount: 3 });
      expect(result.nextTurnIndex).toBe(0);
      expect(result.nextRound).toBe(2);
      expect(result.roundAdvanced).toBe(true);
    });
  });

  describe("applyDamage and checkDeath", () => {
    it("applyDamage floors at 0", () => {
      expect(applyDamage(10, 5)).toBe(5);
      expect(applyDamage(10, 15)).toBe(0);
    });

    it("checkDeath works", () => {
      expect(checkDeath(10)).toBe(false);
      expect(checkDeath(0)).toBe(true);
      expect(checkDeath(-5)).toBe(true);
    });
  });

  describe("resolveEncounterEnd", () => {
    it("returns player_dead if player is dead despite enemy status", () => {
      const combatants = [
        { isPlayer: true, hp: 0 },
        { isPlayer: false, hp: 0 }
      ];
      expect(resolveEncounterEnd(combatants)).toEqual({ shouldEnd: true, reason: "player_dead" });
    });

    it("returns all_enemies_dead when all enemies at 0 hp", () => {
      const combatants = [
        { isPlayer: true, hp: 10 },
        { isPlayer: false, hp: 0 },
        { isPlayer: false, hp: 0 }
      ];
      expect(resolveEncounterEnd(combatants)).toEqual({ shouldEnd: true, reason: "all_enemies_dead" });
    });

    it("returns ongoing otherwise", () => {
      const combatants = [
        { isPlayer: true, hp: 10 },
        { isPlayer: false, hp: 0 },
        { isPlayer: false, hp: 5 }
      ];
      expect(resolveEncounterEnd(combatants)).toEqual({ shouldEnd: false, reason: "ongoing" });
    });
  });

  describe("acFromMonsterData", () => {
    it("extracts from correct field", () => {
      expect(acFromMonsterData({ armor_class: [{ value: 14 }] })).toBe(14);
    });

    it("falls back to 10", () => {
      expect(acFromMonsterData({})).toBe(10);
      expect(acFromMonsterData({ armor_class: [] })).toBe(10);
      expect(acFromMonsterData({ armor_class: [{ type: "natural" }] })).toBe(10);
    });
  });

  describe("acFromInventory", () => {
    it("calculates unarmored correctly", () => {
      expect(acFromInventory([], 3)).toBe(13); // 10 + 3
    });

    it("calculates with full dex bonus (light armor)", () => {
      const inventory = [{ type: "armor", properties: { baseAC: 12 } }];
      expect(acFromInventory(inventory, 4)).toBe(16); // 12 + 4
    });

    it("calculates with capped dex bonus (medium armor)", () => {
      const inventory = [{ type: "armor", properties: { baseAC: 14, maxDexBonus: 2 } }];
      expect(acFromInventory(inventory, 4)).toBe(16); // 14 + 2
      expect(acFromInventory(inventory, 1)).toBe(15); // 14 + 1
    });

    it("calculates with no dex bonus (heavy armor)", () => {
      const inventory = [{ type: "armor", properties: { baseAC: 18, addDexModifier: false } }];
      expect(acFromInventory(inventory, 4)).toBe(18); // 18 + 0
      expect(acFromInventory(inventory, -1)).toBe(18); // even negative usually doesn't apply per 5e RAW, though our implementation treats addDex=false as exactly 0 dex bonus.
    });
  });

  describe("resolveAttackRoll", () => {
    it("resolves basic hit", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.45); // 10
      const result = resolveAttackRoll(5, 14); // 10 + 5 = 15 >= 14
      expect(result.hit).toBe(true);
      expect(result.critical).toBe(false);
      expect(result.fumble).toBe(false);
    });

    it("resolves critical hit on nat 20", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99); // 20
      const result = resolveAttackRoll(-5, 25); // 15 < 25, but nat 20 hits
      expect(result.hit).toBe(true);
      expect(result.critical).toBe(true);
    });

    it("resolves fumble on nat 1", () => {
      vi.spyOn(Math, "random").mockReturnValue(0); // 1
      const result = resolveAttackRoll(20, 10); // 21 >= 10, but nat 1 misses
      expect(result.hit).toBe(false);
      expect(result.fumble).toBe(true);
    });
  });
});

// =============================================================================
// Milestone J — Slice 1: Consequences Engine
// =============================================================================

// ─── Shared helpers ──────────────────────────────────────────────────────────

function makeFacts(overrides: Partial<CombatFacts> = {}): CombatFacts {
  return {
    attacker: "PC:Test",
    defender: "NPC:Goblin",
    weapon: "Longsword",
    damage: 10,
    damage_type: "slashing",
    hp_before: 20,
    hp_after: 10,
    maxHp: 20,
    is_crit: false,
    is_fumble: false,
    hit_location: "chest",
    status_applied: [],
    overkill: 0,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<EncounterSnapshot> = {}): EncounterSnapshot {
  return {
    round: 1,
    totalDamageDealt: 0,
    status: "active",
    currentBeat: "opening",
    defenderId: "npc1",
    combatants: [
      { id: "pc1", hp: 30, maxHp: 30, isPlayer: true,  isBoss: false, hpBeforeThisTurn: 30 },
      { id: "npc1", hp: 10, maxHp: 10, isPlayer: false, isBoss: false, hpBeforeThisTurn: 10 },
    ],
    ...overrides,
  };
}

const zeroTension: TensionState = {
  score: 0,
  avg_enemy_hp_ratio: 1,
  player_hp_ratio: 1,
  enemy_count: 1,
  boss_alive: false,
};

// ─── rollDamage ──────────────────────────────────────────────────────────────

describe("rollDamage", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("rolls the given dice notation and returns total + rolls array", () => {
    // Math.random → 0.5: floor(0.5 * 8) + 1 = 5 on a d8
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = rollDamage("1d8", false);
    expect(result.total).toBe(5);
    expect(result.rolls).toHaveLength(1);
    expect(result.rolls[0]).toBe(5);
  });

  it("includes a flat modifier in total but not in rolls array", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // d8 → 5
    const result = rollDamage("1d8+3", false);
    expect(result.total).toBe(8); // 5 + 3
    expect(result.rolls).toHaveLength(1);
    expect(result.rolls[0]).toBe(5);
  });

  it("on a crit, doubles the dice count (2d8 instead of 1d8)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // each d8 → 5
    const result = rollDamage("1d8", true);
    expect(result.total).toBe(10); // 5 + 5
    expect(result.rolls).toHaveLength(2);
  });

  it("crit preserves modifier (counted once, not doubled)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // each d8 → 5
    const result = rollDamage("1d8+3", true);
    expect(result.total).toBe(13); // 5 + 5 + 3
  });

  it("handles multi-dice notation (2d6)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // each d6 → floor(0.5*6)+1 = 4
    const result = rollDamage("2d6", false);
    expect(result.rolls).toHaveLength(2);
    expect(result.total).toBe(8);
  });
});

// ─── rollHitLocation ─────────────────────────────────────────────────────────

describe("rollHitLocation", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns a valid HitLocation", () => {
    const valid: HitLocation[] = [
      "head", "neck", "shoulder", "chest", "abdomen",
      "arm", "hand", "leg", "knee", "foot",
    ];
    const result = rollHitLocation();
    expect(valid).toContain(result);
  });

  it("covers all 10 locations across many calls", () => {
    const seen = new Set<string>();
    // 200 calls should statistically cover all 10 locations
    for (let i = 0; i < 200; i++) seen.add(rollHitLocation());
    expect(seen.size).toBe(10);
  });
});

// ─── computeOverkill ─────────────────────────────────────────────────────────

describe("computeOverkill", () => {
  it("returns 0 when damage is less than hpBefore", () => {
    expect(computeOverkill(10, 20)).toBe(0);
  });

  it("returns 0 when damage equals hpBefore (exact kill)", () => {
    expect(computeOverkill(10, 10)).toBe(0);
  });

  it("returns excess damage when damage > hpBefore", () => {
    expect(computeOverkill(15, 10)).toBe(5);
    expect(computeOverkill(20, 1)).toBe(19);
  });

  it("never returns a negative value", () => {
    expect(computeOverkill(1, 100)).toBe(0);
  });
});

// ─── computeTension ──────────────────────────────────────────────────────────

describe("computeTension", () => {
  it("returns score=0 for full-health encounter with no boss", () => {
    const combatants = [
      { hp: 30, maxHp: 30, isPlayer: true,  isBoss: false },
      { hp: 10, maxHp: 10, isPlayer: false, isBoss: false },
    ];
    const result = computeTension(combatants);
    // avg_enemy_hp_ratio=1, player_hp_ratio=1 → w1*(0)+w2*(0) = 0
    expect(result.score).toBe(0);
  });

  it("increases as enemy HP drops (w1 term)", () => {
    const combatants = [
      { hp: 30, maxHp: 30, isPlayer: true,  isBoss: false },
      { hp: 5,  maxHp: 10, isPlayer: false, isBoss: false },
    ];
    const result = computeTension(combatants);
    // avg_enemy_hp_ratio=0.5 → w1*(1-0.5)=0.3*0.5=0.15
    expect(result.score).toBeCloseTo(0.15, 5);
    expect(result.avg_enemy_hp_ratio).toBeCloseTo(0.5, 5);
  });

  it("increases as player HP drops (w2 term)", () => {
    const combatants = [
      { hp: 15, maxHp: 30, isPlayer: true,  isBoss: false },
      { hp: 10, maxHp: 10, isPlayer: false, isBoss: false },
    ];
    const result = computeTension(combatants);
    // player_hp_ratio=0.5 → w2*(1-0.5)=0.3*0.5=0.15
    expect(result.score).toBeCloseTo(0.15, 5);
    expect(result.player_hp_ratio).toBeCloseTo(0.5, 5);
  });

  it("adds boss tension when boss is alive (w4 term)", () => {
    const combatants = [
      { hp: 30, maxHp: 30, isPlayer: true,  isBoss: false },
      { hp: 50, maxHp: 50, isPlayer: false, isBoss: true  },
    ];
    const result = computeTension(combatants);
    // w4 * 0.15 = 0.2 * 0.15 = 0.03
    expect(result.score).toBeCloseTo(0.03, 5);
    expect(result.boss_alive).toBe(true);
  });

  it("does NOT add boss tension when boss is dead", () => {
    const combatants = [
      { hp: 30, maxHp: 30, isPlayer: true,  isBoss: false },
      { hp: 0,  maxHp: 50, isPlayer: false, isBoss: true  },
    ];
    const result = computeTension(combatants);
    expect(result.boss_alive).toBe(false);
    // Dead boss at hp=0 makes avg_enemy_hp_ratio=0, so w1*(1-0)=0.3 applies.
    // Score is NOT 0 — the dead boss still drove tension via the hp-ratio term.
    expect(result.score).toBeCloseTo(0.3, 5);
  });

  it("adds enemy-count tension for more than 2 enemies (w3 term)", () => {
    // 3 enemies → 0.2 * (0.1 * 3) = 0.06
    const combatants = [
      { hp: 30, maxHp: 30, isPlayer: true,  isBoss: false },
      { hp: 10, maxHp: 10, isPlayer: false, isBoss: false },
      { hp: 10, maxHp: 10, isPlayer: false, isBoss: false },
      { hp: 10, maxHp: 10, isPlayer: false, isBoss: false },
    ];
    const result = computeTension(combatants);
    expect(result.enemy_count).toBe(3);
    expect(result.score).toBeCloseTo(0.06, 5);
  });

  it("caps enemy-count contribution at 6 enemies", () => {
    function makeGroup(n: number) {
      return [
        { hp: 30, maxHp: 30, isPlayer: true,  isBoss: false },
        ...Array.from({ length: n }, () => ({ hp: 10, maxHp: 10, isPlayer: false, isBoss: false })),
      ];
    }
    const at6 = computeTension(makeGroup(6)).score;
    const at8 = computeTension(makeGroup(8)).score;
    expect(at6).toBeCloseTo(at8, 5);
  });

  it("clamps score to [0, 1]", () => {
    const extreme = [
      { hp: 1,  maxHp: 100, isPlayer: true,  isBoss: false },
      { hp: 0,  maxHp: 10,  isPlayer: false, isBoss: true  },
      { hp: 0,  maxHp: 10,  isPlayer: false, isBoss: false },
      { hp: 0,  maxHp: 10,  isPlayer: false, isBoss: false },
      { hp: 0,  maxHp: 10,  isPlayer: false, isBoss: false },
      { hp: 0,  maxHp: 10,  isPlayer: false, isBoss: false },
      { hp: 0,  maxHp: 10,  isPlayer: false, isBoss: false },
    ];
    const result = computeTension(extreme);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ─── computeNarrativeIntensity ────────────────────────────────────────────────

describe("computeNarrativeIntensity", () => {
  it("returns 0 for a trivial scratch (damage < 10% maxHp), no other modifiers", () => {
    // damage=1, maxHp=20: 1/20=0.05 < 0.1 → base=-0.20 → clamped to 0
    const facts = makeFacts({ damage: 1, hp_before: 20, hp_after: 19, maxHp: 20 });
    expect(computeNarrativeIntensity(facts, zeroTension)).toBe(0);
  });

  it("adds 0.40 for a critical hit", () => {
    // chest, no status, damage/maxHp=0.5 (not scratch), no death
    const facts = makeFacts({ is_crit: true, damage: 10, maxHp: 20 });
    expect(computeNarrativeIntensity(facts, zeroTension)).toBeCloseTo(0.40, 5);
  });

  it("adds 0.20 for a kill shot (hp_after <= 0)", () => {
    const facts = makeFacts({ hp_after: 0, damage: 20, hp_before: 20 });
    expect(computeNarrativeIntensity(facts, zeroTension)).toBeCloseTo(0.20, 5);
  });

  it("adds 0.05 × overkill points (capped at 4)", () => {
    const facts4  = makeFacts({ hp_after: 0, damage: 24, hp_before: 20, overkill: 4  });
    const facts10 = makeFacts({ hp_after: 0, damage: 30, hp_before: 20, overkill: 10 });
    const base4  = computeNarrativeIntensity(facts4,  zeroTension);
    const base10 = computeNarrativeIntensity(facts10, zeroTension);
    // base = 0.20(death) + 0.05*4(overkill) = 0.40
    expect(base4).toBeCloseTo(0.40, 5);
    // capped at 4, so overkill=10 should produce same as overkill=4
    expect(base10).toBeCloseTo(base4, 5);
  });

  it("adds 0.10 for any applied status effect", () => {
    const facts = makeFacts({ status_applied: ["bleeding"], damage: 10, maxHp: 20 });
    expect(computeNarrativeIntensity(facts, zeroTension)).toBeCloseTo(0.10, 5);
  });

  it("adds 0.10 for head or neck hit locations", () => {
    const head  = makeFacts({ hit_location: "head",  damage: 10, maxHp: 20 });
    const neck  = makeFacts({ hit_location: "neck",  damage: 10, maxHp: 20 });
    const chest = makeFacts({ hit_location: "chest", damage: 10, maxHp: 20 });
    expect(computeNarrativeIntensity(head,  zeroTension)).toBeCloseTo(0.10, 5);
    expect(computeNarrativeIntensity(neck,  zeroTension)).toBeCloseTo(0.10, 5);
    expect(computeNarrativeIntensity(chest, zeroTension)).toBeCloseTo(0.00, 5);
  });

  it("scales with tension.score × 0.30", () => {
    const tension: TensionState = { ...zeroTension, score: 1.0 };
    const facts = makeFacts({ damage: 10, maxHp: 20 }); // no other bonus triggers
    expect(computeNarrativeIntensity(facts, tension)).toBeCloseTo(0.30, 5);
  });

  it("clamps to [0, 1] for maximum stacking", () => {
    const tension: TensionState = { ...zeroTension, score: 1.0 };
    const facts = makeFacts({
      is_crit: true,
      hp_after: 0,
      overkill: 4,
      status_applied: ["bleeding"],
      hit_location: "head",
      damage: 10,
      maxHp: 20,
    });
    const result = computeNarrativeIntensity(facts, tension);
    expect(result).toBeLessThanOrEqual(1.0);
    expect(result).toBeGreaterThanOrEqual(0.0);
  });
});

// ─── deriveCombatBeat ────────────────────────────────────────────────────────

describe("deriveCombatBeat", () => {
  it("returns 'opening' when round=1 and no damage has been dealt", () => {
    const snap = makeSnapshot({ round: 1, totalDamageDealt: 0 });
    const facts = makeFacts({ damage: 0 });
    expect(deriveCombatBeat(snap, facts)).toBe("opening");
  });

  it("returns 'first_blood' when totalDamageDealt equals this action's damage (first hit ever)", () => {
    const snap = makeSnapshot({ round: 1, totalDamageDealt: 5, currentBeat: "opening" });
    const facts = makeFacts({ damage: 5 });
    expect(deriveCombatBeat(snap, facts)).toBe("first_blood");
  });

  it("returns 'climax' when the boss dies this turn", () => {
    const snap = makeSnapshot({
      round: 2,
      totalDamageDealt: 30,
      defenderId: "boss1",
      combatants: [
        { id: "pc1",   hp: 15,  maxHp: 30, isPlayer: true,  isBoss: false, hpBeforeThisTurn: 30 },
        { id: "boss1", hp: 0,   maxHp: 50, isPlayer: false, isBoss: true,  hpBeforeThisTurn: 10 },
      ],
    });
    const facts = makeFacts({ hp_after: 0 });
    expect(deriveCombatBeat(snap, facts)).toBe("climax");
  });

  it("returns 'turning_point' when any combatant crosses below 50% HP this turn", () => {
    // pc1 moves from 16/30 (53.3%) to 14/30 (46.7%) — crosses 50%
    const snap = makeSnapshot({
      round: 2,
      totalDamageDealt: 20,
      combatants: [
        { id: "pc1",  hp: 14, maxHp: 30, isPlayer: true,  isBoss: false, hpBeforeThisTurn: 16 },
        { id: "npc1", hp: 5,  maxHp: 10, isPlayer: false, isBoss: false, hpBeforeThisTurn: 5  },
      ],
    });
    expect(deriveCombatBeat(snap, makeFacts())).toBe("turning_point");
  });

  it("does NOT return 'turning_point' when combatant was already below 50% before this turn", () => {
    // pc1 already below 50% before AND after — no crossing
    const snap = makeSnapshot({
      round: 2,
      totalDamageDealt: 20,
      combatants: [
        { id: "pc1",  hp: 10, maxHp: 30, isPlayer: true,  isBoss: false, hpBeforeThisTurn: 12 },
        { id: "npc1", hp: 5,  maxHp: 10, isPlayer: false, isBoss: false, hpBeforeThisTurn: 5  },
      ],
    });
    // Neither crosses 50% this turn (both already below)
    expect(deriveCombatBeat(snap, makeFacts())).not.toBe("turning_point");
  });

  it("returns 'aftermath' when encounter is resolved", () => {
    const snap = makeSnapshot({ status: "resolved", currentBeat: "climax" });
    expect(deriveCombatBeat(snap, makeFacts({ damage: 0 }))).toBe("aftermath");
  });

  it("carries forward currentBeat when no special condition triggers", () => {
    const snap = makeSnapshot({ round: 2, totalDamageDealt: 20, currentBeat: "first_blood" });
    // damage=5 but totalDamageDealt=20 (not equal) → not first_blood again; no other trigger
    expect(deriveCombatBeat(snap, makeFacts({ damage: 5 }))).toBe("first_blood");
  });
});

// ─── deriveStyleDSL ───────────────────────────────────────────────────────────

describe("deriveStyleDSL", () => {
  it("always sets voice='active', verbs='hard', adverbs='low'", () => {
    for (const intensity of [0.1, 0.5, 0.9]) {
      const s = deriveStyleDSL(intensity, "first_blood");
      expect(s.voice).toBe("active");
      expect(s.verbs).toBe("hard");
      expect(s.adverbs).toBe("low");
    }
  });

  it("maps high intensity (>0.7) to high visual + short sentences", () => {
    const s = deriveStyleDSL(0.9, "climax");
    expect(s.visual).toBe("high");
    expect(s.sentences).toBe("short");
  });

  it("maps low intensity (<0.3) to low visual + long sentences", () => {
    const s = deriveStyleDSL(0.1, "opening");
    expect(s.visual).toBe("low");
    expect(s.sentences).toBe("long");
  });

  it("maps moderate intensity (0.3–0.7) to medium visual + medium sentences", () => {
    const s = deriveStyleDSL(0.5, "first_blood");
    expect(s.visual).toBe("medium");
    expect(s.sentences).toBe("medium");
  });

  it("senses count is higher for high intensity than low", () => {
    const low  = deriveStyleDSL(0.1, "opening");
    const high = deriveStyleDSL(0.9, "climax");
    expect(high.senses).toBeGreaterThan(low.senses);
  });

  it("senses count stays within [0, 3]", () => {
    for (const i of [0, 0.5, 1.0]) {
      const s = deriveStyleDSL(i, "first_blood");
      expect(s.senses).toBeGreaterThanOrEqual(0);
      expect(s.senses).toBeLessThanOrEqual(3);
    }
  });
});

// ─── selectSenses ────────────────────────────────────────────────────────────

describe("selectSenses", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("always returns exactly 2 senses", () => {
    expect(selectSenses([])).toHaveLength(2);
    expect(selectSenses(["sight", "sound", "smell", "touch", "taste"])).toHaveLength(2);
  });

  it("returns only valid sense names", () => {
    const all = ["sight", "sound", "smell", "touch", "taste"];
    const result = selectSenses([]);
    for (const s of result) expect(all).toContain(s);
  });

  it("avoids recently used senses when alternatives exist", () => {
    // Only "taste" is not in usedRecently — must be included
    const result = selectSenses(["sight", "sound", "smell", "touch"]);
    expect(result).toContain("taste");
  });

  it("returns no duplicates", () => {
    const result = selectSenses([]);
    expect(new Set(result).size).toBe(2);
  });
});

// ─── deriveNarrativeTags ─────────────────────────────────────────────────────

describe("deriveNarrativeTags", () => {
  it("returns a non-empty string array for a common combination", () => {
    const tags = deriveNarrativeTags(makeFacts({ damage_type: "slashing", hit_location: "head", is_crit: true }));
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(typeof t).toBe("string");
  });

  it("returns different tags for crit vs normal hit on the same location", () => {
    const crit = deriveNarrativeTags(makeFacts({ damage_type: "slashing", hit_location: "head", is_crit: true }));
    const hit  = deriveNarrativeTags(makeFacts({ damage_type: "slashing", hit_location: "head", is_crit: false }));
    expect(crit).not.toEqual(hit);
  });

  it("does not throw for any valid damage_type × hit_location combination", () => {
    const types: CombatFacts["damage_type"][] = [
      "slashing","piercing","bludgeoning","fire","cold",
      "lightning","acid","poison","necrotic","radiant","psychic","thunder","force",
    ];
    const locs: CombatFacts["hit_location"][] = [
      "head","neck","shoulder","chest","abdomen","arm","hand","leg","knee","foot",
    ];
    for (const dt of types) {
      for (const loc of locs) {
        expect(() =>
          deriveNarrativeTags(makeFacts({ damage_type: dt, hit_location: loc }))
        ).not.toThrow();
      }
    }
  });

  it("returns an array (possibly empty) for any combination — never throws", () => {
    const facts = makeFacts({ damage_type: "fire", hit_location: "foot", is_crit: false });
    expect(() => deriveNarrativeTags(facts)).not.toThrow();
    expect(Array.isArray(deriveNarrativeTags(facts))).toBe(true);
  });
});

// ─── selectTacticalHooks ─────────────────────────────────────────────────────

describe("selectTacticalHooks", () => {
  it("returns an array", () => {
    expect(Array.isArray(selectTacticalHooks(makeFacts(), []))).toBe(true);
  });

  it("suggests 'disarm' when hit location is arm", () => {
    expect(selectTacticalHooks(makeFacts({ hit_location: "arm"  }), [])).toContain("disarm");
  });

  it("suggests 'disarm' when hit location is hand", () => {
    expect(selectTacticalHooks(makeFacts({ hit_location: "hand" }), [])).toContain("disarm");
  });

  it("suggests 'trip' when hit location is leg, knee, or foot", () => {
    for (const loc of ["leg", "knee", "foot"] as const) {
      expect(selectTacticalHooks(makeFacts({ hit_location: loc }), [])).toContain("trip");
    }
  });

  it("suggests 'exploit' when there is overkill", () => {
    expect(selectTacticalHooks(makeFacts({ overkill: 5 }), [])).toContain("exploit");
  });

  it("returns only lowercase strings", () => {
    const hooks = selectTacticalHooks(makeFacts({ hit_location: "arm", overkill: 3 }), []);
    for (const h of hooks) expect(h).toBe(h.toLowerCase());
  });
});

// ─── computeConsequences ─────────────────────────────────────────────────────

describe("computeConsequences", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns a structurally complete CombatConsequences payload", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = computeConsequences({
      attacker:          "PC:Kara",
      defender:          "NPC:Goblin",
      weapon:            "Longsword",
      weaponDice:        "1d8",
      attackModifier:    5,
      damageType:        "slashing",
      targetAC:          12,
      targetHp:          10,
      targetMaxHp:       10,
      targetIsPlayer:    false,
      targetIsBoss:      false,
      statusApplied:     [],
      encounterSnapshot: makeSnapshot(),
      usedSenses:        [],
      zones:             [],
    });

    // Required top-level keys
    expect(result).toHaveProperty("combat_facts");
    expect(result).toHaveProperty("narrative_tags");
    expect(result).toHaveProperty("narrative_intensity");
    expect(result).toHaveProperty("combat_beat");
    expect(result).toHaveProperty("style_dsl");
    expect(result).toHaveProperty("suggested_senses");
    expect(result).toHaveProperty("suggested_actions");

    // Value range checks
    expect(result.narrative_intensity).toBeGreaterThanOrEqual(0);
    expect(result.narrative_intensity).toBeLessThanOrEqual(1);
    expect(result.suggested_senses).toHaveLength(2);
    expect(Array.isArray(result.narrative_tags)).toBe(true);
    expect(Array.isArray(result.suggested_actions)).toBe(true);
  });

  it("combat_facts.attacker and .defender match the input", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = computeConsequences({
      attacker:          "PC:Kara",
      defender:          "NPC:Orc",
      weapon:            "Axe",
      weaponDice:        "1d6",
      attackModifier:    3,
      damageType:        "slashing",
      targetAC:          14,
      targetHp:          20,
      targetMaxHp:       20,
      targetIsPlayer:    false,
      targetIsBoss:      false,
      statusApplied:     [],
      encounterSnapshot: makeSnapshot(),
      usedSenses:        [],
      zones:             [],
    });
    expect(result.combat_facts.attacker).toBe("PC:Kara");
    expect(result.combat_facts.defender).toBe("NPC:Orc");
  });

  it("on a miss, damage is 0 and hp is unchanged", () => {
    // Math.random → 0 means d20 = 1 (fumble — always miss)
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = computeConsequences({
      attacker:          "PC:Kara",
      defender:          "NPC:Goblin",
      weapon:            "Longsword",
      weaponDice:        "1d8",
      attackModifier:    0,
      damageType:        "slashing",
      targetAC:          30, // very high AC, will miss
      targetHp:          10,
      targetMaxHp:       10,
      targetIsPlayer:    false,
      targetIsBoss:      false,
      statusApplied:     [],
      encounterSnapshot: makeSnapshot(),
      usedSenses:        [],
      zones:             [],
    });
    expect(result.combat_facts.is_fumble).toBe(true);
    expect(result.combat_facts.damage).toBe(0);
    expect(result.combat_facts.hp_after).toBe(10);
  });
});
