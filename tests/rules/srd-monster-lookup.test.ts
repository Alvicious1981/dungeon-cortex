import { beforeEach, describe, expect, it, vi } from "vitest";

// srd-monster-lookup.ts imports `prisma` directly from "@/lib/db/prisma" (it is
// not dependency-injected the way encounter-service's `queryMonsters` callback
// is), so it is mocked the same way tests/rules/srd-equipment-lookup.test.ts
// mocks the equipment lookup's prisma import.
const srdMonsterMock = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { srdMonster: srdMonsterMock },
}));

import { queryMonsters } from "@/lib/rules/srd-monster-lookup";

// One row carrying four distinct, non-empty values for the four
// damage/condition modifier columns. Distinct values mean a copy-paste error
// between the four projection lines (e.g. resistances reading from the
// immunities column) fails a test that checking `[]` on all four would not
// catch.
const GOBLIN_ROW = {
  id: "goblin",
  name: "Goblin",
  indexSlug: "goblin",
  cr: 0.25,
  xp: 50,
  type: "humanoid",
  size: "Small",
  alignment: "neutral evil",
  hitPoints: 7,
  hitDice: "2d6",
  armorClass: 15,
  speed: 30,
  languages: "Common, Goblin",
  strength: 8,
  dexterity: 14,
  constitution: 10,
  intelligence: 10,
  wisdom: 8,
  charisma: 8,
  damageImmunities: ["fire"],
  damageResistances: ["cold"],
  damageVulnerabilities: ["thunder"],
  conditionImmunities: ["poisoned"],
  hasLegendaryActions: false,
  hasSpellcasting: false,
};

beforeEach(() => {
  srdMonsterMock.findMany.mockReset();
});

describe("queryMonsters projection", () => {
  it("carries all four damage/condition modifier columns onto the Monster under their snake_case names", async () => {
    srdMonsterMock.findMany.mockResolvedValue([GOBLIN_ROW]);

    const [monster] = await queryMonsters({});

    expect(monster.damage_immunities).toEqual(["fire"]);
    expect(monster.damage_resistances).toEqual(["cold"]);
    expect(monster.damage_vulnerabilities).toEqual(["thunder"]);
    expect(monster.condition_immunities).toEqual(["poisoned"]);
  });

  it("maps the row's camelCase name to the Monster", async () => {
    srdMonsterMock.findMany.mockResolvedValue([GOBLIN_ROW]);

    const [monster] = await queryMonsters({});

    expect(monster.name).toBe("Goblin");
    expect(monster.index).toBe("goblin");
  });
});
