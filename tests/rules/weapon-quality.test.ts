import { describe, expect, it } from "vitest";
import { weaponQualitiesFor, WEAPON_QUALITIES } from "@/lib/rules/weapon-quality";

/**
 * Nothing in the game said a weapon was magical, so four SRD damage clauses
 * covering 69 of the data's 72 conditional entries were paid in full. A declared
 * quality is authoritative; a numeric bonus is the SRD's own definition of a
 * magic weapon, so it derives one. Anything else grants nothing, because
 * guessing is what this project does not do.
 */
describe("weaponQualitiesFor", () => {
  it("reads a declared quality", () => {
    expect(weaponQualitiesFor({ qualities: ["silvered"] })).toEqual(["silvered"]);
  });

  it("normalises case and whitespace on a declared quality", () => {
    expect(weaponQualitiesFor({ qualities: [" Adamantine "] })).toEqual(["adamantine"]);
  });

  it("grants nothing for a quality it does not know", () => {
    expect(weaponQualitiesFor({ qualities: ["cold-iron", "blessed"] })).toEqual([]);
  });

  it("derives magical from a damage bonus", () => {
    expect(weaponQualitiesFor({ damageBonus: 1 })).toEqual(["magical"]);
  });

  it("derives nothing from a zero or absent bonus", () => {
    expect(weaponQualitiesFor({ damageBonus: 0 })).toEqual([]);
    expect(weaponQualitiesFor({ damageDice: "1d8" })).toEqual([]);
  });

  it("leaves a silvered weapon nonmagical when it has no bonus", () => {
    // The whole point of the "that aren't silvered" wording: silver lifts that
    // clause and does not lift the plain nonmagical one.
    const qualities = weaponQualitiesFor({ qualities: ["silvered"] });
    expect(qualities).toContain("silvered");
    expect(qualities).not.toContain("magical");
  });

  it("does not repeat magical when it is both declared and derived", () => {
    expect(weaponQualitiesFor({ qualities: ["magical"], damageBonus: 2 })).toEqual(["magical"]);
  });

  it("grants nothing for a row with no properties at all", () => {
    expect(weaponQualitiesFor(null)).toEqual([]);
    expect(weaponQualitiesFor(undefined)).toEqual([]);
    expect(weaponQualitiesFor("a string")).toEqual([]);
  });

  it("exports the three qualities the engine knows", () => {
    expect([...WEAPON_QUALITIES]).toEqual(["magical", "silvered", "adamantine"]);
  });
});
