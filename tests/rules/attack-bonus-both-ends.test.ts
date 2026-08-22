import { describe, expect, it, vi } from "vitest";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";
import {
  readWeaponProfile,
  weaponAttackBonus,
  type WeaponProfile,
} from "@/lib/rules/weapon-profile";
import { resolveWeaponProfile } from "@/lib/rules/weapon-profile-service";

const getEquipmentInfo = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rules/srd-equipment-lookup", () => ({ getEquipmentInfo }));

/**
 * The sheet and the die must show the same number.
 *
 * They diverged silently for a long time: the view-model honoured Finesse while
 * the action route used a fixed Strength modifier, and the view-model applied
 * the proficiency bonus unconditionally while the backend now does not. Two
 * implementations of one SRD rule is the defect; this guard is what makes a
 * third divergence a CI failure instead of a discovery months later.
 */

const HYDRATED = {
  damageDice: "1d8",
  damageBonus: 0,
  damageType: "Slashing",
  weaponCategory: "Martial",
  weaponRange: "Melee",
  weaponProperties: ["Versatile"],
};

const FINESSE = { ...HYDRATED, weaponProperties: ["Finesse"] };
const RANGED = { ...HYDRATED, weaponRange: "Ranged", weaponProperties: [] };

function sheetBonus(
  characterClass: string,
  level: number,
  stats: Record<string, number>,
  properties: Record<string, unknown>,
  resolved?: WeaponProfile,
): number {
  const sheet = buildSheetViewModel({
    character: {
      id: "c1",
      name: "Test",
      race: "human",
      class: characterClass,
      level,
      hp: 10,
      maxHp: 10,
      xp: 0,
      stats,
    },
    inventory: [
      {
        id: "w1",
        name: "Longsword",
        type: "weapon",
        quantity: 1,
        equippedSlot: "MAIN_HAND",
        properties,
      },
    ],
    weaponProfiles: resolved ? new Map([["w1", resolved]]) : undefined,
  });

  return sheet.attacks[0].bonus;
}

function backendBonus(
  characterClass: string,
  level: number,
  stats: Record<string, number>,
  properties: Record<string, unknown>,
): number {
  return weaponAttackBonus({
    profile: readWeaponProfile(properties),
    stats,
    characterClass,
    level,
  }).bonus;
}

describe("the sheet's attack bonus equals the backend's", () => {
  it.each([
    ["a proficient class", "barbarian", 1, { STR: 16, DEX: 14 }, HYDRATED],
    ["a class without the category", "wizard", 1, { STR: 16, DEX: 14 }, HYDRATED],
    ["a class outside the twelve", "artificer", 1, { STR: 16, DEX: 14 }, HYDRATED],
    ["proficiency scaling at level 5", "fighter", 5, { STR: 16, DEX: 14 }, HYDRATED],
    ["proficiency scaling at level 20", "fighter", 20, { STR: 16, DEX: 14 }, HYDRATED],
    ["a finesse weapon and a nimble character", "rogue", 1, { STR: 8, DEX: 18 }, FINESSE],
    ["a finesse weapon and a strong character", "rogue", 1, { STR: 18, DEX: 8 }, FINESSE],
    ["a ranged weapon", "ranger", 1, { STR: 16, DEX: 14 }, RANGED],
  ])("agrees for %s", (_label, characterClass, level, stats, properties) => {
    expect(sheetBonus(characterClass, level, stats, properties)).toBe(
      backendBonus(characterClass, level, stats, properties),
    );
  });

  it("shows a wizard no proficiency with a martial weapon", () => {
    // Pins the direction, not just the agreement: if both ends regressed to
    // applying proficiency unconditionally, the equality test above would still
    // pass. +3 STR and nothing else.
    expect(sheetBonus("wizard", 1, { STR: 16, DEX: 14 }, HYDRATED)).toBe(3);
  });

  it("reads the canonical weaponProperties key", () => {
    // The old key was `properties.properties`. A weapon whose traits live under
    // the canonical name must have its finesse honoured: DEX 18 (+4) beats
    // STR 8 (-1). If the key went unread, traits would be empty, finesse would
    // not apply, and the ability would be STR for -1 — so 4 is the proof.
    //
    // No proficiency: a rogue has only the simple category in this model
    // (lib/rules/proficiency.ts:82), and the rapier/shortsword grants the SRD
    // gives rogues individually are deliberately handled outside that table.
    expect(sheetBonus("rogue", 1, { STR: 8, DEX: 18 }, FINESSE)).toBe(4);
  });
});

/**
 * The path every character that exists today actually takes.
 *
 * Every row above is hydrated — category, range and traits all present — which
 * is precisely why the legacy shape went untested on both ends. A character
 * created before this branch carries damage and nothing else, so the backend
 * fills the category from `SrdItem` and the sheet, resolving with
 * `readWeaponProfile` alone, saw no category at all: +4 rolled against +2
 * displayed for a level-1 barbarian with a Longsword.
 */
const LEGACY = { damageDice: "1d8", damageBonus: 0, damageType: "slashing" };

const SRD_LONGSWORD = {
  name: "Longsword",
  weaponCategory: "Martial",
  weaponRange: "Melee",
  damageDice: "1d8",
  damageType: "Slashing",
  properties: ["Versatile"],
};

describe("a legacy weapon row, with no persisted category", () => {
  it("shows the sheet the same number the backend rolls", async () => {
    getEquipmentInfo.mockResolvedValue(SRD_LONGSWORD);

    // Exactly what the attack sites do, and now what the sheet's callers do.
    const resolved = await resolveWeaponProfile({ name: "Longsword", properties: LEGACY });
    expect(resolved.category).toBe("martial");

    const backend = weaponAttackBonus({
      profile: resolved,
      stats: { STR: 14, DEX: 10 },
      characterClass: "barbarian",
      level: 1,
    });

    // +2 STR, +2 proficiency — a barbarian has the martial category.
    expect(backend.proficiencyApplied).toBe(true);
    expect(backend.bonus).toBe(4);
    expect(sheetBonus("barbarian", 1, { STR: 14, DEX: 10 }, LEGACY, resolved)).toBe(
      backend.bonus,
    );
  });

  it("is what the sheet would get wrong without the resolved profile", async () => {
    // Pins the direction: unresolved, the row has no category, so no
    // proficiency — +2 against the +4 the die rolls. This is the divergence,
    // and it is why the map is passed rather than the view-model left pure and
    // uninformed.
    expect(sheetBonus("barbarian", 1, { STR: 14, DEX: 10 }, LEGACY)).toBe(2);
  });
});
