import { describe, expect, it } from "vitest";
import { resolveWeaponAttackProfile } from "@/lib/rules/weapons";
import type { ContextCombatant } from "@/lib/memory/context";
import type { TacticalMap } from "@/lib/rules/geometry";

const map: TacticalMap = {
  gridType: "SQUARE",
  width: 12,
  height: 12,
  cellSize: 5,
};

const attacker: ContextCombatant = {
  id: "player",
  name: "Hero",
  isPlayer: true,
  hp: 20,
  maxHp: 20,
  ac: 15,
  initiativeTotal: 10,
  conditions: [],
  stats: { STR: 12, DEX: 16 },
  concentrationSpellId: null,
  x: 0,
  y: 0,
  size: "Medium",
};

function targetAt(x: number, y: number): ContextCombatant {
  return {
    id: `target-${x}-${y}`,
    name: "Target",
    isPlayer: false,
    hp: 10,
    maxHp: 10,
    ac: 12,
    initiativeTotal: 8,
    conditions: [],
    stats: {},
    concentrationSpellId: null,
    x,
    y,
    size: "Medium",
  };
}

describe("resolveWeaponAttackProfile", () => {
  it("uses Dexterity for a ranged weapon attack", () => {
    const profile = resolveWeaponAttackProfile({
      properties: {
        weaponRange: "Ranged",
        rangeNormal: 80,
        rangeLong: 320,
        weaponProperties: ["ammunition", "two-handed"],
      },
      attacker,
      target: targetAt(6, 0),
      map,
      actorStats: { STR: 12, DEX: 16 },
    });

    expect(profile.isMeleeAttack).toBe(false);
    expect(profile.attackAbilityModifier).toBe(3);
    expect(profile.damageAbilityModifier).toBe(3);
  });

  it("uses the better finesse modifier for a melee weapon", () => {
    const profile = resolveWeaponAttackProfile({
      properties: {
        weaponRange: "Melee",
        rangeNormal: 5,
        weaponProperties: ["finesse"],
      },
      attacker,
      target: targetAt(1, 0),
      map,
      actorStats: { STR: 12, DEX: 16 },
    });

    expect(profile.isMeleeAttack).toBe(true);
    expect(profile.maxRangeFt).toBe(5);
    expect(profile.attackAbilityModifier).toBe(3);
  });

  it("extends melee reach for reach weapons", () => {
    const profile = resolveWeaponAttackProfile({
      properties: {
        weaponRange: "Melee",
        rangeNormal: 5,
        weaponProperties: ["finesse", "reach"],
      },
      attacker,
      target: targetAt(2, 0),
      map,
      actorStats: { STR: 12, DEX: 16 },
    });

    expect(profile.isMeleeAttack).toBe(true);
    expect(profile.maxRangeFt).toBe(10);
    expect(profile.distanceFt).toBe(10);
  });

  it("keeps thrown melee weapons in melee mode when adjacent", () => {
    const profile = resolveWeaponAttackProfile({
      properties: {
        weaponRange: "Melee",
        rangeNormal: 5,
        rangeLong: 5,
        throwRangeNormal: 20,
        throwRangeLong: 60,
        weaponProperties: ["thrown"],
      },
      attacker,
      target: targetAt(1, 0),
      map,
      actorStats: { STR: 12, DEX: 16 },
    });

    expect(profile.isMeleeAttack).toBe(true);
    expect(profile.maxRangeFt).toBe(5);
    expect(profile.attackAbilityModifier).toBe(1);
  });

  it("uses a melee thrown weapon's throw range beyond melee reach", () => {
    const profile = resolveWeaponAttackProfile({
      properties: {
        weaponRange: "Melee",
        rangeNormal: 5,
        rangeLong: 5,
        throwRangeNormal: 20,
        throwRangeLong: 60,
        weaponProperties: ["thrown"],
      },
      attacker,
      target: targetAt(4, 0),
      map,
      actorStats: { STR: 12, DEX: 16 },
    });

    expect(profile.isMeleeAttack).toBe(false);
    expect(profile.maxRangeFt).toBe(60);
    expect(profile.longRangeDisadvantage).toBe(false);
    expect(profile.attackAbilityModifier).toBe(1);
  });

  it("applies long-range disadvantage instead of rejecting within long range", () => {
    const profile = resolveWeaponAttackProfile({
      properties: {
        weaponRange: "Melee",
        rangeNormal: 5,
        rangeLong: 5,
        throwRangeNormal: 20,
        throwRangeLong: 60,
        weaponProperties: ["thrown"],
      },
      attacker,
      target: targetAt(6, 0),
      map,
      actorStats: { STR: 12, DEX: 16 },
    });

    expect(profile.maxRangeFt).toBe(60);
    expect(profile.longRangeDisadvantage).toBe(true);
  });

  it("keeps ranged thrown weapons ranged even when adjacent", () => {
    const profile = resolveWeaponAttackProfile({
      properties: {
        weaponRange: "Ranged",
        rangeNormal: 20,
        rangeLong: 60,
        throwRangeNormal: 20,
        throwRangeLong: 60,
        weaponProperties: ["finesse", "thrown"],
      },
      attacker,
      target: targetAt(1, 0),
      map,
      actorStats: { STR: 12, DEX: 16 },
    });

    expect(profile.isMeleeAttack).toBe(false);
    expect(profile.attackAbilityModifier).toBe(3);
  });
});
