import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  averageDamage,
  isMonsterAttackProfile,
  profileMonster,
  recogniseAttack,
  RECOGNISED_RANGES,
  RECOGNISED_WALK_SPEEDS,
} from "@/lib/rules/monster-attack-profile";

/**
 * Bound against the real file prisma/seed-srd.ts loads into SrdMonster.data,
 * the discipline of tests/rules/damage-clauses.test.ts: an unseen wording
 * fails here instead of passing unnoticed. Figures from the enemy-turns spec §4.
 */
const MONSTERS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "monsters.json"), "utf8"),
) as Array<Record<string, unknown>>;

function monster(index: string): Record<string, unknown> {
  const found = MONSTERS.find((m) => m.index === index);
  if (!found) throw new Error(`fixture monster ${index} missing`);
  return found;
}

function attackActions(): Array<{ key: string; action: unknown }> {
  return MONSTERS.flatMap((m) =>
    ((m.actions as Array<Record<string, unknown>> | undefined) ?? [])
      .filter((a) => typeof a.attack_bonus === "number")
      .map((a) => ({ key: `${m.index as string}:${a.name as string}`, action: a })),
  );
}

const UNRECOGNISED = [
  "ancient-black-dragon:Bite", "bandit:Light Crossbow", "behir:Constrict",
  "couatl:Constrict", "druid:Quarterstaff", "dryad:Club", "elephant:Stomp",
  "elk:Hooves", "ettercap:Web", "giant-crocodile:Tail", "giant-elk:Hooves",
  "giant-spider:Web", "gladiator:Spear", "guardian-naga:Spit Poison",
  "lamia:Intoxicating Touch", "mammoth:Stomp", "octopus:Ink Cloud",
  "pit-fiend:Claw", "pit-fiend:Mace", "pit-fiend:Tail", "roper:Tendril",
  "rug-of-smothering:Smother", "salamander:Spear", "scout:Longbow",
  "succubus-incubus:Draining Kiss", "swarm-of-bats:Bites",
  "swarm-of-beetles:Bites", "swarm-of-centipedes:Bites",
  "swarm-of-insects:Bites", "swarm-of-poisonous-snakes:Bites",
  "swarm-of-quippers:Bites", "swarm-of-rats:Bites", "swarm-of-ravens:Beaks",
  "swarm-of-spiders:Bites", "swarm-of-wasps:Bites", "triceratops:Stomp",
  "vampire-bat:Bite", "vampire-spawn:Bite", "vampire-vampire:Bite",
];

describe("monster attack profile", () => {
  it("profiles the goblin exactly", () => {
    expect(profileMonster(monster("goblin"))).toEqual({
      version: 1,
      walkSpeedFt: 30,
      attacks: [
        {
          name: "Scimitar", attackBonus: 4, melee: { reachFt: 5 }, ranged: null,
          damage: [{ dice: "1d6+2", type: "slashing" }],
        },
        {
          name: "Shortbow", attackBonus: 4, melee: null,
          ranged: { normalFt: 80, longFt: 320 },
          damage: [{ dice: "1d6+2", type: "piercing" }],
        },
      ],
      multiattack: null,
    });
  });

  it("resolves a structured multiattack into its parts", () => {
    expect(profileMonster(monster("brown-bear"))?.multiattack).toEqual([
      { attack: "Bite", count: 1 },
      { attack: "Claws", count: 1 },
    ]);
  });

  it("reduces a versatile choice to its lowest-average option", () => {
    const spear = profileMonster(monster("guard"))?.attacks.find((a) => a.name === "Spear");
    expect(spear?.damage).toEqual([{ dice: "1d6+1", type: "piercing" }]);
  });

  it("keeps flat damage as a fixed amount", () => {
    const bite = profileMonster(monster("badger"))?.attacks.find((a) => a.name === "Bite");
    expect(bite?.damage).toEqual([{ dice: "1", type: "piercing" }]);
  });

  it("breaks a damage-type tie by type name", () => {
    const scimitar = profileMonster(monster("djinni"))?.attacks.find((a) => a.name === "Scimitar");
    expect(scimitar?.damage).toHaveLength(2);
    expect(scimitar?.damage).toEqual(
      expect.arrayContaining([
        { dice: "2d6+5", type: "slashing" },
        { dice: "1d6", type: "lightning" },
      ]),
    );
  });

  it("falls back to one attack when a multiattack part is not an attack", () => {
    expect(profileMonster(monster("adult-red-dragon"))?.multiattack).toBeNull();
    expect(profileMonster(monster("bandit-captain"))?.multiattack).toBeNull();
  });

  it("leaves exactly the pinned attacks unrecognised", () => {
    const unrecognised = attackActions()
      .filter(({ action }) => recogniseAttack(action) === null)
      .map(({ key }) => key)
      .sort();
    expect(unrecognised).toEqual([...UNRECOGNISED].sort());
    expect(attackActions().length - unrecognised.length).toBe(496);
  });

  it("profiles 316 of the 334 monsters", () => {
    expect(MONSTERS).toHaveLength(334);
    expect(MONSTERS.filter((m) => profileMonster(m) !== null)).toHaveLength(316);
  });

  it("resolves multiattack for the measured monsters", () => {
    // 83, not the 85 first measured: that measurement did not check `count`.
    // The hydra ("Number of Heads") and the violet fungus ("1d4") attack a
    // variable number of times, which no fixed plan can represent, so both
    // fall back to a single attack like any other unresolvable multiattack.
    const withPlan = MONSTERS.filter((m) => profileMonster(m)?.multiattack != null);
    expect(withPlan).toHaveLength(83);
    expect(profileMonster(monster("hydra"))?.multiattack).toBeNull();
    expect(profileMonster(monster("violet-fungus"))?.multiattack).toBeNull();
  });

  it("holds no range or walk entry the data does not use", () => {
    const usedRanges = new Set<string>();
    const usedWalks = new Set<string>();
    for (const m of MONSTERS) {
      const profile = profileMonster(m);
      const walk = (m.speed as { walk?: unknown } | undefined)?.walk;
      if (typeof walk === "string") usedWalks.add(walk);
      for (const a of profile?.attacks ?? []) {
        if (a.ranged) {
          usedRanges.add(
            a.ranged.longFt === null
              ? `${a.ranged.normalFt}`
              : `${a.ranged.normalFt}/${a.ranged.longFt}`,
          );
        }
      }
    }
    expect([...RECOGNISED_RANGES.keys()].filter((k) => !usedRanges.has(k))).toEqual([]);
    expect([...RECOGNISED_WALK_SPEEDS.keys()].filter((k) => !usedWalks.has(k))).toEqual([]);
  });

  it("refuses a reach of 0 even under a clean header", () => {
    // Every reach-0 attack in the SRD also fails on its header ("in the
    // swarm's space"), so the data alone never exercises this rule. A synthetic
    // action keeps it covered: footprints never overlap on the grid.
    expect(
      recogniseAttack({
        name: "Engulf",
        attack_bonus: 3,
        desc: "Melee Weapon Attack: +3 to hit, reach 0 ft., one target. Hit: 5 (1d6 + 2) bludgeoning damage.",
        damage: [{ damage_type: { index: "bludgeoning" }, damage_dice: "1d6+2" }],
      }),
    ).toBeNull();
  });

  it("averages dice and flat damage", () => {
    expect(averageDamage("1d6+2")).toBe(5.5);
    expect(averageDamage("2d6")).toBe(7);
    expect(averageDamage("1")).toBe(1);
  });

  it("accepts every produced profile and rejects malformed ones", () => {
    for (const m of MONSTERS) {
      const profile = profileMonster(m);
      if (profile) expect(isMonsterAttackProfile(profile)).toBe(true);
    }
    expect(isMonsterAttackProfile(null)).toBe(false);
    expect(
      isMonsterAttackProfile({ version: 2, walkSpeedFt: 30, attacks: [], multiattack: null }),
    ).toBe(false);
    expect(
      isMonsterAttackProfile({ version: 1, walkSpeedFt: 30, attacks: [], multiattack: null }),
    ).toBe(false);
  });
});
