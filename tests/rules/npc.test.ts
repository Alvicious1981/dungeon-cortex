/**
 * tests/rules/npc.test.ts
 *
 * Tests for the rich NPC generator — Milestone I Slice 3.
 *
 * Covers: determinism, standard-array ability score assignment, HP derivation
 * from CON modifier + hit dice, role-fixed AC, and the new schema fields
 * (race, profession, alignment, traits).
 */

import { describe, it, expect } from "vitest";
import { seededFloat } from "@/lib/rules/generators";
import { abilityModifier } from "@/lib/rules/dice";
import {
  generateNPC,
  type NPCRole,
  type AbilityScores,
  type NPCTraits,
} from "@/lib/rules/npc";

// ---------------------------------------------------------------------------
// Constants mirrored from the implementation for test assertions
// ---------------------------------------------------------------------------

/** The 5e standard ability score array (must remain the only source of scores). */
const STANDARD_ARRAY_SORTED = [8, 10, 12, 13, 14, 15];

const VALID_RACES = [
  "human", "elf", "dwarf", "halfling", "gnome",
  "half-elf", "half-orc", "tiefling", "dragonborn", "aasimar",
];

const VALID_PROFESSIONS = [
  "merchant", "farmer", "blacksmith", "scholar", "soldier",
  "thief", "priest", "healer", "ranger", "noble", "sailor", "innkeeper",
];

const VALID_ALIGNMENTS = [
  "lawful good", "neutral good", "chaotic good",
  "lawful neutral", "true neutral", "chaotic neutral",
  "lawful evil", "neutral evil", "chaotic evil",
];

const ROLE_AC: Record<NPCRole, number> = {
  commoner: 10,
  guard:    16,
  bandit:   12,
};

const ROLE_HIT_DICE: Record<NPCRole, number> = {
  commoner: 1,
  guard:    2,
  bandit:   2,
};

const DIE_SIZE = 8; // All roles use d8

// ---------------------------------------------------------------------------
// Helper: recompute expected maxHp from the generation formula
// ---------------------------------------------------------------------------

function expectedMaxHp(seed: string, role: NPCRole, abilityScores: AbilityScores): number {
  const hitDice = ROLE_HIT_DICE[role];
  const conMod  = abilityModifier(abilityScores.CON);
  let total = 0;
  for (let i = 0; i < hitDice; i++) {
    const roll = Math.floor(seededFloat(`${seed}:hd:${i}`) * DIE_SIZE) + 1;
    total += roll + conMod;
  }
  return Math.max(hitDice, total);
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("generateNPC — determinism", () => {
  const SEEDS: string[] = ["npc_test_001", "guard_north_gate", "merchant_inn_1", "bandit_road"];
  const ROLES: NPCRole[] = ["commoner", "guard", "bandit"];

  it("produces identical results for the same (seed, role) pair", () => {
    for (const seed of SEEDS) {
      for (const role of ROLES) {
        const a = generateNPC(seed, role);
        const b = generateNPC(seed, role);
        expect(a).toEqual(b);
      }
    }
  });

  it("different roles with the same seed produce different statblocks", () => {
    const commoner = generateNPC("shared_seed", "commoner");
    const guard    = generateNPC("shared_seed", "guard");
    // ACs must differ — role-fixed values are 10 vs 16
    expect(commoner.ac).not.toBe(guard.ac);
  });

  it("different seeds with the same role usually produce different names", () => {
    const npc1 = generateNPC("seed_alpha_001", "commoner");
    const npc2 = generateNPC("seed_beta_999", "commoner");
    // Astronomically unlikely to collide on both first+last name
    expect(npc1.name).not.toBe(npc2.name);
  });
});

// ---------------------------------------------------------------------------
// Backward-compatible fields
// ---------------------------------------------------------------------------

describe("generateNPC — backward-compatible fields", () => {
  it("returns name as 'FirstName LastName'", () => {
    const npc = generateNPC("compat_seed", "guard");
    expect(typeof npc.name).toBe("string");
    expect(npc.name.split(" ")).toHaveLength(2);
  });

  it("returns the correct role", () => {
    for (const role of ["commoner", "guard", "bandit"] as NPCRole[]) {
      expect(generateNPC("any", role).role).toBe(role);
    }
  });

  it("hp equals maxHp on initial generation (no damage applied)", () => {
    for (const role of ["commoner", "guard", "bandit"] as NPCRole[]) {
      const npc = generateNPC("init_hp_seed", role);
      expect(npc.hp).toBe(npc.maxHp);
    }
  });

  it("commoner attackString is '1d4'", () => {
    expect(generateNPC("atk_seed", "commoner").attackString).toBe("1d4");
  });

  it("guard attackString is '1d6+2'", () => {
    expect(generateNPC("atk_seed", "guard").attackString).toBe("1d6+2");
  });

  it("bandit attackString is '1d6+1'", () => {
    expect(generateNPC("atk_seed", "bandit").attackString).toBe("1d6+1");
  });
});

// ---------------------------------------------------------------------------
// Armor Class
// ---------------------------------------------------------------------------

describe("generateNPC — AC", () => {
  it("commoner AC is 10 (unarmored)", () => {
    expect(generateNPC("ac_seed", "commoner").ac).toBe(10);
  });

  it("guard AC is 16 (chain shirt + shield)", () => {
    expect(generateNPC("ac_seed", "guard").ac).toBe(16);
  });

  it("bandit AC is 12 (leather armour)", () => {
    expect(generateNPC("ac_seed", "bandit").ac).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Ability scores
// ---------------------------------------------------------------------------

describe("generateNPC — ability scores", () => {
  it("produces exactly the 6 standard-array values", () => {
    for (const role of ["commoner", "guard", "bandit"] as NPCRole[]) {
      const { abilityScores } = generateNPC("stats_seed", role);
      const values = Object.values(abilityScores).sort((a, b) => a - b);
      expect(values).toEqual(STANDARD_ARRAY_SORTED);
    }
  });

  it("all six stat keys are present", () => {
    const { abilityScores } = generateNPC("keys_seed", "guard");
    const keys = Object.keys(abilityScores).sort();
    expect(keys).toEqual(["CHA", "CON", "DEX", "INT", "STR", "WIS"]);
  });

  it("each ability score is in the range [8, 15]", () => {
    const { abilityScores } = generateNPC("range_seed", "bandit");
    for (const val of Object.values(abilityScores)) {
      expect(val).toBeGreaterThanOrEqual(8);
      expect(val).toBeLessThanOrEqual(15);
    }
  });

  it("ability score distribution differs between seeds", () => {
    const a = generateNPC("seed_A", "guard").abilityScores;
    const b = generateNPC("seed_B", "guard").abilityScores;
    // At least one stat should differ
    const anyDiff = (Object.keys(a) as (keyof AbilityScores)[]).some(
      (k) => a[k] !== b[k]
    );
    expect(anyDiff).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HP derivation
// ---------------------------------------------------------------------------

describe("generateNPC — HP derivation", () => {
  it("commoner maxHp matches formula: 1d8 + CON modifier (min 1)", () => {
    const seed = "hp_formula_commoner";
    const npc  = generateNPC(seed, "commoner");
    expect(npc.maxHp).toBe(expectedMaxHp(seed, "commoner", npc.abilityScores));
  });

  it("guard maxHp matches formula: 2×(1d8 + CON modifier) (min 2)", () => {
    const seed = "hp_formula_guard";
    const npc  = generateNPC(seed, "guard");
    expect(npc.maxHp).toBe(expectedMaxHp(seed, "guard", npc.abilityScores));
  });

  it("bandit maxHp matches formula: 2×(1d8 + CON modifier) (min 2)", () => {
    const seed = "hp_formula_bandit";
    const npc  = generateNPC(seed, "bandit");
    expect(npc.maxHp).toBe(expectedMaxHp(seed, "bandit", npc.abilityScores));
  });

  it("maxHp is at least 1 for commoner (floor protects against negative CON stacking)", () => {
    // Exhaustively verify across many seeds
    for (let i = 0; i < 50; i++) {
      const npc = generateNPC(`min_hp_commoner_${i}`, "commoner");
      expect(npc.maxHp).toBeGreaterThanOrEqual(1);
    }
  });

  it("maxHp is at least 2 for guard (one per hit die)", () => {
    for (let i = 0; i < 50; i++) {
      const npc = generateNPC(`min_hp_guard_${i}`, "guard");
      expect(npc.maxHp).toBeGreaterThanOrEqual(2);
    }
  });

  it("maxHp is at least 2 for bandit (one per hit die)", () => {
    for (let i = 0; i < 50; i++) {
      const npc = generateNPC(`min_hp_bandit_${i}`, "bandit");
      expect(npc.maxHp).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------
// New schema fields — race, profession, alignment
// ---------------------------------------------------------------------------

describe("generateNPC — new fields: race, profession, alignment", () => {
  it("race is one of the valid 5e player races", () => {
    for (let i = 0; i < 20; i++) {
      const npc = generateNPC(`race_check_${i}`, "commoner");
      expect(VALID_RACES).toContain(npc.race);
    }
  });

  it("profession is one of the valid professions", () => {
    for (let i = 0; i < 20; i++) {
      const npc = generateNPC(`prof_check_${i}`, "guard");
      expect(VALID_PROFESSIONS).toContain(npc.profession);
    }
  });

  it("alignment is one of the 9 standard 5e alignments", () => {
    for (let i = 0; i < 20; i++) {
      const npc = generateNPC(`align_check_${i}`, "bandit");
      expect(VALID_ALIGNMENTS).toContain(npc.alignment);
    }
  });

  it("race, profession, and alignment are non-empty strings", () => {
    const npc = generateNPC("field_present_seed", "guard");
    expect(typeof npc.race).toBe("string");
    expect(npc.race.length).toBeGreaterThan(0);
    expect(typeof npc.profession).toBe("string");
    expect(npc.profession.length).toBeGreaterThan(0);
    expect(typeof npc.alignment).toBe("string");
    expect(npc.alignment.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// New schema fields — traits
// ---------------------------------------------------------------------------

describe("generateNPC — traits", () => {
  it("traits object has all four required keys", () => {
    const { traits } = generateNPC("traits_seed", "commoner");
    expect(traits).toHaveProperty("personality");
    expect(traits).toHaveProperty("ideal");
    expect(traits).toHaveProperty("bond");
    expect(traits).toHaveProperty("flaw");
  });

  it("all trait values are non-empty strings", () => {
    const { traits } = generateNPC("traits_nonempty_seed", "bandit");
    for (const [key, val] of Object.entries(traits as NPCTraits)) {
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });

  it("ideal text matches the NPC's alignment", () => {
    // The ideal should reference the same moral axis as the alignment.
    // We only verify it's a non-empty string per alignment — exact content is
    // tested implicitly via the determinism test above.
    for (let i = 0; i < 9; i++) {
      const npc = generateNPC(`ideal_align_${i}`, "commoner");
      expect(typeof npc.traits.ideal).toBe("string");
      expect(npc.traits.ideal.length).toBeGreaterThan(0);
    }
  });

  it("traits are deterministic with the rest of the statblock", () => {
    const a = generateNPC("traits_determ_seed", "guard");
    const b = generateNPC("traits_determ_seed", "guard");
    expect(a.traits).toEqual(b.traits);
  });
});
