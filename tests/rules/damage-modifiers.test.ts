import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAMAGE_TYPES,
  applyDamageModifiers,
  unresolvedModifierLog,
  type DamageType,
} from "@/lib/rules/damage-modifiers";

const NONE: { immunities: string[]; resistances: string[]; vulnerabilities: string[] } = {
  immunities: [],
  resistances: [],
  vulnerabilities: [],
};

function apply(damage: number, damageType: DamageType, modifiers: Partial<typeof NONE>) {
  return applyDamageModifiers({
    damage,
    damageType,
    modifiers: { ...NONE, ...modifiers },
  });
}

describe("applyDamageModifiers — the SRD order", () => {
  it("leaves damage alone when nothing applies", () => {
    expect(apply(10, "fire", {})).toEqual({ damage: 10, applied: "none", unresolved: [] });
  });

  it("immunity takes the damage to zero", () => {
    expect(apply(10, "fire", { immunities: ["fire"] })).toEqual({
      damage: 0,
      applied: "immune",
      unresolved: [],
    });
  });

  it("immunity beats vulnerability rather than fighting it", () => {
    expect(
      apply(10, "fire", { immunities: ["fire"], vulnerabilities: ["fire"] }).damage,
    ).toBe(0);
  });

  it("resistance halves", () => {
    expect(apply(10, "cold", { resistances: ["cold"] })).toEqual({
      damage: 5,
      applied: "resistant",
      unresolved: [],
    });
  });

  it("halving rounds down, including one to zero", () => {
    expect(apply(7, "cold", { resistances: ["cold"] }).damage).toBe(3);
    expect(apply(1, "cold", { resistances: ["cold"] }).damage).toBe(0);
  });

  it("vulnerability doubles", () => {
    expect(apply(7, "bludgeoning", { vulnerabilities: ["bludgeoning"] })).toEqual({
      damage: 14,
      applied: "vulnerable",
      unresolved: [],
    });
  });

  it("resistance and vulnerability on the same type cancel", () => {
    // SRD says so outright. Reporting "cancelled" rather than "none" keeps the
    // two distinguishable: one means the rules met and stopped each other, the
    // other means nothing was ever there.
    expect(
      apply(9, "fire", { resistances: ["fire"], vulnerabilities: ["fire"] }),
    ).toEqual({ damage: 9, applied: "cancelled", unresolved: [] });
  });

  it("ignores a modifier for a different damage type", () => {
    expect(apply(10, "fire", { resistances: ["cold"], immunities: ["poison"] }).damage).toBe(10);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(apply(10, "fire", { immunities: ["  Fire "] }).damage).toBe(0);
  });
});

describe("applyDamageModifiers — clauses it cannot evaluate", () => {
  const CLAUSE = "bludgeoning, piercing, and slashing from nonmagical weapons";

  it("reports a conditional clause instead of guessing at it", () => {
    const result = apply(10, "slashing", { resistances: [CLAUSE] });

    expect(result.damage).toBe(10);
    expect(result.applied).toBe("none");
    expect(result.unresolved).toEqual([CLAUSE]);
  });

  it("does not let a clause that mentions the type match it", () => {
    // The clause contains the word "slashing". A substring match would halve
    // this, which is a mechanical outcome inferred from prose.
    expect(apply(10, "slashing", { resistances: [CLAUSE] }).damage).toBe(10);
  });

  it("still applies the bare types beside a clause", () => {
    const result = apply(10, "cold", {
      resistances: ["cold", CLAUSE],
    });

    expect(result.damage).toBe(5);
    expect(result.applied).toBe("resistant");
    expect(result.unresolved).toEqual([CLAUSE]);
  });

  it("reports each unresolved clause once, in order, without duplicates", () => {
    const other = "damage from spells";
    expect(apply(10, "fire", { resistances: [CLAUSE, other], immunities: [CLAUSE] }).unresolved)
      .toEqual([CLAUSE, other]);
  });

  it("de-duplicates two casings of the same clause, reporting the first spelling seen", () => {
    // Matching normalises case and surrounding space (see the test above,
    // "matches case-insensitively"). De-duplication must use the same
    // normalisation, or two spellings of one clause both survive into the
    // log a player reads.
    const shouted = CLAUSE.toUpperCase();
    const result = apply(10, "slashing", { resistances: [CLAUSE, shouted] });

    expect(result.unresolved).toEqual([CLAUSE]);
  });
});

describe("unresolvedModifierLog", () => {
  const CLAUSE = "bludgeoning, piercing, and slashing from nonmagical weapons";

  it("reports the clause when nothing else resolved the hit and damage landed", () => {
    // The case the design exists for: only an unresolvable clause, real
    // damage got through, so the player is owed the explanation.
    const result = apply(10, "slashing", { resistances: [CLAUSE] });

    const log = unresolvedModifierLog({ defenderName: "Werewolf", result });

    expect(log).not.toBeNull();
    expect(log).toContain(CLAUSE);
    expect(log).toContain("Werewolf");
  });

  it("stays silent when there is no unresolved clause", () => {
    const result = apply(10, "fire", {});
    expect(unresolvedModifierLog({ defenderName: "Goblin", result })).toBeNull();
  });

  it("stays silent when a bare immunity resolved the same hit as an unresolved clause", () => {
    // The engine already said what happened ("immune") — a sentence claiming
    // "full damage was applied" alongside that would be false.
    const result = apply(10, "fire", { immunities: ["fire"], resistances: [CLAUSE] });
    expect(result.applied).toBe("immune");
    expect(result.unresolved).toEqual([CLAUSE]);

    expect(unresolvedModifierLog({ defenderName: "Balor", result })).toBeNull();
  });

  it("stays silent when a bare resistance resolved the same hit as an unresolved clause", () => {
    const result = apply(10, "cold", { resistances: ["cold", CLAUSE] });
    expect(result.applied).toBe("resistant");
    expect(result.unresolved).toEqual([CLAUSE]);

    expect(unresolvedModifierLog({ defenderName: "Frost Giant", result })).toBeNull();
  });

  it("stays silent when no damage landed — a miss or a heal, not a bounced sword", () => {
    const result = apply(0, "slashing", { resistances: [CLAUSE] });
    expect(result.damage).toBe(0);

    expect(unresolvedModifierLog({ defenderName: "Werewolf", result })).toBeNull();
  });
});

describe("unresolvedModifierLog — against the real monster file", () => {
  /**
   * Finds a real SRD monster that is immune to some bare damage type *and*
   * separately carries an unresolvable clause — the Balor shape: immune to
   * fire and poison outright, resistant to nonmagical weapons conditionally.
   * Located programmatically against the actual file rather than hand-picked,
   * so this keeps working if the data changes which monster has the shape.
   */
  function findImmuneWithClause():
    | { name: string; damageType: DamageType; modifiers: typeof NONE }
    | undefined {
    const keys = ["damage_immunities", "damage_resistances", "damage_vulnerabilities"] as const;

    for (const monster of MONSTERS) {
      const immunities = Array.isArray(monster.damage_immunities)
        ? (monster.damage_immunities as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      const bareImmuneType = immunities
        .map((s) => s.trim().toLowerCase())
        .find((s) => (DAMAGE_TYPES as readonly string[]).includes(s));
      if (!bareImmuneType) continue;

      const hasClause = keys.some((key) => {
        const value = monster[key];
        return (
          Array.isArray(value) &&
          value.some(
            (s) => typeof s === "string" && !(DAMAGE_TYPES as readonly string[]).includes(s.trim().toLowerCase()),
          )
        );
      });
      if (!hasClause) continue;

      return {
        name: String(monster.name ?? monster.index ?? "unknown"),
        damageType: bareImmuneType as DamageType,
        modifiers: {
          immunities: Array.isArray(monster.damage_immunities) ? (monster.damage_immunities as string[]) : [],
          resistances: Array.isArray(monster.damage_resistances) ? (monster.damage_resistances as string[]) : [],
          vulnerabilities: Array.isArray(monster.damage_vulnerabilities)
            ? (monster.damage_vulnerabilities as string[])
            : [],
        },
      };
    }
    return undefined;
  }

  it("stays silent for a real monster immune to the incoming type that also carries a clause (the Balor case)", () => {
    const found = findImmuneWithClause();

    // Guards the guard: if no monster in the file has this shape, the
    // scenario this finding describes cannot be exercised at all.
    expect(found).toBeDefined();
    const { name, damageType, modifiers } = found!;

    const result = applyDamageModifiers({ damage: 20, damageType, modifiers });
    expect(result.applied).toBe("immune");
    expect(result.unresolved.length).toBeGreaterThan(0);

    const log = unresolvedModifierLog({ defenderName: name, result });

    expect(log).toBeNull();
  });
});

describe("applyDamageModifiers — malformed input", () => {
  it("never throws on values Postgres can hand back", () => {
    for (const junk of [null, undefined, 42, {}, []] as unknown[]) {
      expect(() =>
        applyDamageModifiers({
          damage: 10,
          damageType: "fire",
          modifiers: {
            immunities: junk as string[],
            resistances: junk as string[],
            vulnerabilities: junk as string[],
          },
        }),
      ).not.toThrow();
    }
  });

  it("returns zero damage unchanged rather than doubling it", () => {
    expect(apply(0, "fire", { vulnerabilities: ["fire"] }).damage).toBe(0);
  });

  it("never returns negative damage", () => {
    expect(apply(-5, "fire", {}).damage).toBe(0);
  });
});

/**
 * The partition, against the file the seeder reads.
 *
 * This deliberately does not enumerate the conditional clause shapes. An
 * earlier draft of the spec named five and asserted the list was complete;
 * there were at least six. A test that depends on someone listing every clause
 * correctly breaks the day the SRD data gains another. This asserts instead
 * that every string lands on exactly one side of the line.
 */
const MONSTERS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
) as Array<Record<string, unknown>>;

function everyModifierString(): string[] {
  const keys = ["damage_immunities", "damage_resistances", "damage_vulnerabilities"] as const;
  return MONSTERS.flatMap((monster) =>
    keys.flatMap((key) => {
      const value = monster[key];
      return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
    }),
  );
}

describe("the real monster file", () => {
  it("has modifier strings to test against at all", () => {
    // Guards the guard: a reader bug that returned [] would make every
    // assertion below vacuously true.
    expect(everyModifierString().length).toBeGreaterThan(100);
  });

  it("partitions every string into matched-or-unresolved, with nothing between", () => {
    for (const raw of everyModifierString()) {
      const normalised = raw.trim().toLowerCase();
      const isBareType = (DAMAGE_TYPES as readonly string[]).includes(normalised);

      if (isBareType) {
        // A bare type is understood: asked about itself, it matches, and
        // nothing is reported as unresolved.
        const result = applyDamageModifiers({
          damage: 10,
          damageType: normalised as DamageType,
          modifiers: { immunities: [raw], resistances: [], vulnerabilities: [] },
        });

        expect(result.damage).toBe(0);
        expect(result.unresolved).toEqual([]);
      } else {
        // A clause changes nothing and is reported verbatim.
        //
        // Asked against a real damage type, never against itself: casting a
        // clause to `DamageType` and passing it as the damage type would make
        // the exact-match succeed against its own string, and this test would
        // assert the opposite of what it means. "fire" is used because no
        // clause in the file is the word "fire".
        const result = applyDamageModifiers({
          damage: 10,
          damageType: "fire",
          modifiers: { immunities: [raw], resistances: [], vulnerabilities: [] },
        });

        expect(result.damage).toBe(10);
        expect(result.unresolved).toEqual([raw]);
      }
    }
  });

  it("finds at least one clause and at least one bare type", () => {
    // Otherwise the branch above could be exercising only one arm.
    const all = everyModifierString().map((s) => s.trim().toLowerCase());
    const bare = all.filter((s) => (DAMAGE_TYPES as readonly string[]).includes(s));
    expect(bare.length).toBeGreaterThan(0);
    expect(all.length - bare.length).toBeGreaterThan(0);
  });
});
