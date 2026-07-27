import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/campaign/[id]/encounter/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getCombatantOccupiedSquares, normalizeSizeCategory } from "@/lib/rules/geometry";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    encounter: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    encounterMap: { create: vi.fn() },
    combatant: { createMany: vi.fn() },
    srdMonster: { findUnique: vi.fn() },
    $transaction: vi.fn(async (callback) => callback(prisma)),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {},
}));

vi.mock("@/lib/rules/combat", () => ({
  rollInitiative: vi.fn((inputs: Array<{ id: string }>) => ({
    order: inputs.map((input, index) => ({ id: input.id, initiative: 20 - index })),
  })),
  acFromMonsterData: vi.fn(() => 13),
  acFromInventory: vi.fn(() => 15),
}));

describe("Encounter Route - authoritative tactical map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue({ id: "user-1" });
    (prisma.campaign.findUnique as any).mockResolvedValue({
      id: "campaign-1",
      userId: "user-1",
      status: "active",
      character: {
        name: "Aldric",
        hp: 24,
        maxHp: 24,
        stats: { DEX: 14 },
        concentrationSpellId: null,
        inventory: [],
      },
    });
    (prisma.encounter.findFirst as any).mockResolvedValue(null);
    (prisma.encounter.create as any).mockResolvedValue({ id: "encounter-1" });
    (prisma.encounter.findUnique as any).mockResolvedValue({
      id: "encounter-1",
      map: { gridType: "SQUARE", width: 10, height: 10, cellSize: 5 },
      combatants: [],
    });
    (prisma.srdMonster.findUnique as any).mockResolvedValue({
      id: "ogre",
      size: "Large",
      data: {
        size: "Large",
        hit_points: 59,
        dexterity: 8,
        ability_scores: { DEX: 8, CON: 16 },
      },
    });
  });

  it("creates one EncounterMap and non-overlapping size-aware placements in one transaction", async () => {
    const request = new NextRequest("http://localhost/api/campaign/campaign-1/encounter", {
      method: "POST",
      body: JSON.stringify({
        enemies: [{
          name: "Ogre", hp: 1, maxHp: 1, dexModifier: -1, monsterIndex: "ogre",
        }],
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "campaign-1" }) });

    expect(response.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.encounterMap.create).toHaveBeenCalledWith({
      data: {
        encounterId: "encounter-1",
        gridType: "SQUARE",
        width: 10,
        height: 10,
        cellSize: 5,
      },
    });

    const createManyArgs = (prisma.combatant.createMany as any).mock.calls[0][0];
    const player = createManyArgs.data.find((combatant: any) => combatant.isPlayer);
    const ogre = createManyArgs.data.find((combatant: any) => !combatant.isPlayer);
    expect(ogre).toMatchObject({ hp: 59, maxHp: 59, size: "Large" });
    expect(player).not.toHaveProperty("zoneId");
    expect(ogre).not.toHaveProperty("zoneId");

    const playerSquares = getCombatantOccupiedSquares({
      id: "player", x: player.x, y: player.y, size: normalizeSizeCategory(player.size),
    });
    const ogreSquares = getCombatantOccupiedSquares({
      id: "ogre", x: ogre.x, y: ogre.y, size: normalizeSizeCategory(ogre.size),
    });
    expect(ogreSquares.some((square) => playerSquares.some(
      (playerSquare) => playerSquare.x === square.x && playerSquare.y === square.y
    ))).toBe(false);
  });
});
