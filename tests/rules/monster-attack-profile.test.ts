import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  averageDamage,
  isMonsterAttackProfile,
  profileMonster,
  recogniseAttack,
  recogniseAreaSaveAttack,
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
      areaSaveAttack: null,
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

function action(idx: string, name: string): unknown {
  return (monster(idx).actions as Array<Record<string, unknown>>).find((a) => a.name === name);
}

function areaSaveActions(): Array<{ key: string; action: unknown }> {
  return MONSTERS.flatMap((m) =>
    ((m.actions as Array<Record<string, unknown>> | undefined) ?? [])
      .filter((a) => a.attack_bonus === undefined && a.dc !== undefined)
      .map((a) => ({ key: `${m.index as string}:${a.name as string}`, action: a })),
  );
}

/**
 * Every action with no attack_bonus but a dc field, that is NOT one of the 28
 * recognised area-save attacks (spec §2). Includes the 44 condition-only
 * actions, the metallic dragons' choice-based "Breath Weapons" wrapper, and
 * the 4 measured defects — every one of them a real, checked exclusion, not
 * an oversight.
 */
const RECOGNISED_AREA_SAVE = [
  "adult-black-dragon:Acid Breath", "adult-blue-dragon:Lightning Breath",
  "adult-green-dragon:Poison Breath", "adult-red-dragon:Fire Breath",
  "adult-white-dragon:Cold Breath", "ancient-black-dragon:Acid Breath",
  "ancient-blue-dragon:Lightning Breath", "ancient-green-dragon:Poison Breath",
  "ancient-red-dragon:Fire Breath", "ankheg:Acid Spray", "behir:Lightning Breath",
  "chimera:Fire Breath", "dragon-turtle:Steam Breath",
  "green-dragon-wyrmling:Poison Breath", "half-red-dragon-veteran:Fire Breath",
  "hell-hound:Fire Breath", "ice-mephit:Frost Breath", "iron-golem:Poison Breath",
  "magma-mephit:Fire Breath", "steam-mephit:Steam Breath",
  "storm-giant:Lightning Strike", "white-dragon-wyrmling:Cold Breath",
  "winter-wolf:Cold Breath", "young-black-dragon:Acid Breath",
  "young-blue-dragon:Lightning Breath", "young-green-dragon:Poison Breath",
  "young-red-dragon:Fire Breath", "young-white-dragon:Cold Breath",
];

describe("area-save attack recognition (docs/superpowers/specs/2026-09-16-area-save-actions-design.md)", () => {
  it("recognises the adult red dragon's Fire Breath exactly", () => {
    expect(recogniseAreaSaveAttack(action("adult-red-dragon", "Fire Breath"))).toEqual({
      name: "Fire Breath", reachFt: 60, saveAbility: "DEX", saveDC: 21,
      damage: [{ dice: "18d6", type: "fire" }], rechargeMin: 5,
    });
  });

  it("recognises every reach-shape template", () => {
    expect(recogniseAreaSaveAttack(action("adult-black-dragon", "Acid Breath")))
      .toMatchObject({ reachFt: 60 }); // "…in a 60-foot line that is 5 feet wide."
    expect(recogniseAreaSaveAttack(action("ice-mephit", "Frost Breath")))
      .toMatchObject({ reachFt: 15 }); // "exhales a 15-foot cone of cold air."
    expect(recogniseAreaSaveAttack(action("ankheg", "Acid Spray")))
      .toMatchObject({ reachFt: 30 }); // "spits acid in a line that is 30 ft. long…"
    expect(recogniseAreaSaveAttack(action("behir", "Lightning Breath")))
      .toMatchObject({ reachFt: 20 }); // "exhales a line of lightning that is 20 ft. long…"
    expect(recogniseAreaSaveAttack(action("storm-giant", "Lightning Strike")))
      .toMatchObject({ reachFt: 500 }); // "…within 500 feet of it."
    expect(recogniseAreaSaveAttack(action("young-blue-dragon", "Lightning Breath")))
      .toMatchObject({ reachFt: 60 }); // the "an 60-foot line" article typo
  });

  it("leaves exactly the pinned actions unrecognised", () => {
    const recognised = areaSaveActions()
      .filter(({ action }) => recogniseAreaSaveAttack(action) !== null)
      .map(({ key }) => key)
      .sort();
    expect(recognised).toEqual([...RECOGNISED_AREA_SAVE].sort());
  });

  it("rejects a prose/structured mismatch even when the clause parses", () => {
    // black-dragon-wyrmling's Acid Breath: prose damage reads "Sd8" for "5d8".
    expect(recogniseAreaSaveAttack(action("black-dragon-wyrmling", "Acid Breath"))).toBeNull();
  });

  it("never claims a weapon attack's own rider", () => {
    // The aboleth's Tentacle carries a `dc` (the disease rider) but also an
    // attack_bonus: it belongs to recogniseAttack, never to this recogniser.
    const tentacle = action("aboleth", "Tentacle");
    expect(recogniseAreaSaveAttack(tentacle)).toBeNull();
    expect(recogniseAttack(tentacle)).not.toBeNull();
  });

  it("profiles a dragon with both weapon attacks and an area-save attack", () => {
    const profile = profileMonster(monster("adult-red-dragon"));
    expect(profile?.areaSaveAttack).toEqual({
      name: "Fire Breath", reachFt: 60, saveAbility: "DEX", saveDC: 21,
      damage: [{ dice: "18d6", type: "fire" }], rechargeMin: 5,
    });
    expect(profile?.attacks.length).toBeGreaterThan(0); // Bite/Claw, unaffected
  });

  it("carries an area-save-only monster that has no weapon attack", () => {
    // No monster in the current 334 needs this, but a profile must not
    // silently disappear if a future SRD monster has only an area attack.
    const breathOnly = {
      name: "Solitary Wyrm",
      speed: { walk: "30 ft." },
      actions: [
        {
          name: "Fire Breath",
          desc: "The wyrm exhales fire in a 30-foot cone. Each creature in that area must make a DC 15 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.",
          usage: { type: "recharge on roll", dice: "1d6", min_value: 5 },
          dc: { dc_type: { index: "dex" }, dc_value: 15, success_type: "half" },
          damage: [{ damage_type: { index: "fire" }, damage_dice: "7d6" }],
        },
      ],
    };
    const profile = profileMonster(breathOnly);
    expect(profile).not.toBeNull();
    expect(profile?.attacks).toEqual([]);
    expect(profile?.areaSaveAttack?.name).toBe("Fire Breath");
    expect(isMonsterAttackProfile(profile)).toBe(true);
  });

  it("refuses a weapon attack's own rider even when its clause would otherwise match", () => {
    // No monster in the current 334 pairs attack_bonus with a top-level dc
    // whose own desc also forms a valid half-damage clause, so the guard is
    // otherwise never exercised: a synthetic fixture proves it holds anyway.
    const riderWithMatchingClause = {
      name: "Poisoned Strike",
      // Present only to prove the gate: recogniseAttack owns any action with
      // this field, never this recogniser. Every other check here would
      // otherwise pass — valid dc/damage/usage, a valid reach template, and
      // the clause's own numbers agreeing with the structured fields.
      attack_bonus: 6,
      desc: "The creature exhales poison in a 15-foot cone. Each creature in that area must make a DC 13 Constitution saving throw, taking 7 (2d6) poison damage on a failed save, or half as much damage on a successful one.",
      damage: [{ damage_type: { index: "poison" }, damage_dice: "2d6" }],
      dc: { dc_type: { index: "con" }, dc_value: 13, success_type: "half" },
      usage: { type: "recharge on roll", dice: "1d6", min_value: 5 },
    };
    expect(recogniseAreaSaveAttack(riderWithMatchingClause)).toBeNull();
  });

  it("refuses an action whose shape sentence has no recognised reach", () => {
    // Every real recognised action's shape sentence matches one of the 6
    // templates; a synthetic one with an unmeasured wording proves the
    // recogniser fails closed instead of defaulting a reach.
    const unmeasuredShape = {
      name: "Odd Breath",
      desc: "The wyrm exhales frost in an unusual pattern nobody has described before. Each creature nearby must make a DC 15 Dexterity saving throw, taking 10 (3d6) cold damage on a failed save, or half as much damage on a successful one.",
      usage: { type: "recharge on roll", dice: "1d6", min_value: 5 },
      dc: { dc_type: { index: "dex" }, dc_value: 15, success_type: "half" },
      damage: [{ damage_type: { index: "cold" }, damage_dice: "3d6" }],
    };
    expect(recogniseAreaSaveAttack(unmeasuredShape)).toBeNull();
  });

  it("refuses a recharge min_value outside 4/5/6", () => {
    // No real action rolls a recharge below 4 or above 6; a synthetic fixture
    // proves the bound is actually enforced rather than merely never hit.
    const badRecharge = {
      name: "Overcharged Breath",
      desc: "The beast exhales flame in a 15-foot cone. Each creature in that area must make a DC 14 Dexterity saving throw, taking 10 (3d6) fire damage on a failed save, or half as much damage on a successful one.",
      usage: { type: "recharge on roll", dice: "1d6", min_value: 3 },
      dc: { dc_type: { index: "dex" }, dc_value: 14, success_type: "half" },
      damage: [{ damage_type: { index: "fire" }, damage_dice: "3d6" }],
    };
    expect(recogniseAreaSaveAttack(badRecharge)).toBeNull();
  });

  it("refuses a clause DC that disagrees with the structured dc_value", () => {
    // No real action's prose DC diverges from its own structured field except
    // the 4 measured typo defects, none of which land on this exact shape; a
    // synthetic fixture proves the DC slot is actually cross-checked.
    const mismatchedDc = {
      name: "Sour Breath",
      desc: "The beast exhales acid in a 15-foot cone. Each creature in that area must make a DC 14 Dexterity saving throw, taking 10 (3d6) acid damage on a failed save, or half as much damage on a successful one.",
      usage: { type: "recharge on roll", dice: "1d6", min_value: 5 },
      dc: { dc_type: { index: "dex" }, dc_value: 15, success_type: "half" },
      damage: [{ damage_type: { index: "acid" }, damage_dice: "3d6" }],
    };
    expect(recogniseAreaSaveAttack(mismatchedDc)).toBeNull();
  });

  it("refuses a clause ability word that disagrees with the structured dc_type", () => {
    // Proves the ability slot is cross-checked, not just parsed and trusted.
    const mismatchedAbility = {
      name: "Confusing Breath",
      desc: "The beast exhales acid in a 15-foot cone. Each creature in that area must make a DC 14 Dexterity saving throw, taking 10 (3d6) acid damage on a failed save, or half as much damage on a successful one.",
      usage: { type: "recharge on roll", dice: "1d6", min_value: 5 },
      dc: { dc_type: { index: "con" }, dc_value: 14, success_type: "half" },
      damage: [{ damage_type: { index: "acid" }, damage_dice: "3d6" }],
    };
    expect(recogniseAreaSaveAttack(mismatchedAbility)).toBeNull();
  });

  it("keeps recognising every already-persisted profile with no areaSaveAttack key at all", () => {
    // Backward compatibility: a profile written before this field existed.
    expect(
      isMonsterAttackProfile({
        version: 1, walkSpeedFt: 30,
        attacks: [{ name: "Bite", attackBonus: 4, melee: { reachFt: 5 }, ranged: null, damage: [{ dice: "1d6", type: "piercing" }] }],
        multiattack: null,
      }),
    ).toBe(true);
  });
});
