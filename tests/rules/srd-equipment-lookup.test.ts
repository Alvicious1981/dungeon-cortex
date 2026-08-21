import { beforeEach, describe, expect, it, vi } from "vitest";

const srdItemMock = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { srdItem: srdItemMock },
}));

import { getEquipmentInfo } from "@/lib/rules/srd-equipment-lookup";

const LONGSWORD_ROW = {
  id: "longsword",
  name: "Longsword",
  data: {
    name: "Longsword",
    weapon_category: "Martial",
    weapon_range: "Melee",
    damage: { damage_dice: "1d8", damage_type: { name: "Slashing" } },
  },
};

beforeEach(() => {
  srdItemMock.findUnique.mockReset();
  srdItemMock.findMany.mockReset();
  srdItemMock.findUnique.mockResolvedValue(null);
  srdItemMock.findMany.mockResolvedValue([]);
});

describe("getEquipmentInfo", () => {
  it("resolves by exact id", async () => {
    srdItemMock.findUnique.mockResolvedValue(LONGSWORD_ROW);

    const result = await getEquipmentInfo("longsword");

    expect(result?.name).toBe("Longsword");
    expect(result?.weaponCategory).toBe("Martial");
    expect(result?.damageDice).toBe("1d8");
    expect(srdItemMock.findMany).not.toHaveBeenCalled();
  });

  it("falls back to an exact name match, ignoring case and padding", async () => {
    srdItemMock.findMany.mockResolvedValue([LONGSWORD_ROW]);

    const result = await getEquipmentInfo("  LONGSWORD ");

    expect(result?.weaponCategory).toBe("Martial");
  });

  it("returns null rather than the nearest name", async () => {
    // The database would answer an equality query for "Sword" with nothing.
    // This asserts the module does not then settle for a near miss.
    srdItemMock.findMany.mockResolvedValue([]);

    expect(await getEquipmentInfo("Sword")).toBeNull();
  });

  it("never asks the database for a substring match", async () => {
    await getEquipmentInfo("Sword");

    expect(srdItemMock.findMany).toHaveBeenCalledTimes(1);
    const where = srdItemMock.findMany.mock.calls[0][0].where;
    expect(where.name).toHaveProperty("equals");
    expect(where.name).not.toHaveProperty("contains");
  });

  it("discards a row the database returns that is not an exact match", async () => {
    // Belt and braces: even if the query were loosened by a later edit, the
    // module itself must still refuse a row whose name is not the one asked for.
    srdItemMock.findMany.mockResolvedValue([LONGSWORD_ROW]);

    expect(await getEquipmentInfo("Sword")).toBeNull();
  });

  it("reads SrdItem, which holds the data, and never SrdEquipment", async () => {
    srdItemMock.findUnique.mockResolvedValue(LONGSWORD_ROW);
    await getEquipmentInfo("longsword");

    expect(srdItemMock.findUnique).toHaveBeenCalledWith({ where: { id: "longsword" } });
  });
});
