/**
 * POST /api/character — the spell slots a new character starts with.
 *
 * A hand-written list of three classes (wizard, cleric, sorcerer) used to
 * decide who got slots, so a bard, druid or warlock began with none and could
 * never cast a leveled spell. The SRD table decides now.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/character/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { character: { create: vi.fn(async () => ({ id: "char-new" })) } },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {},
}));

vi.mock("@/lib/rules/starting-inventory", () => ({
  buildStartingInventory: vi.fn(async () => []),
}));

const STATS = { STR: 10, DEX: 14, CON: 12, INT: 16, WIS: 12, CHA: 14 };

function create(characterClass: string) {
  return POST(
    new NextRequest("http://localhost/api/character", {
      method: "POST",
      body: JSON.stringify({ name: "Test", race: "human", class: characterClass, stats: STATS }),
    }),
  );
}

function createdSlots(): unknown {
  const [[args]] = (prisma.character.create as ReturnType<typeof vi.fn>).mock.calls as unknown as [
    [{ data: { spellSlots?: unknown } }],
  ];
  return args.data.spellSlots;
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1" });
});

describe("POST /api/character — starting spell slots", () => {
  it.each([
    ["wizard", { "1": { current: 2, max: 2 } }],
    ["bard", { "1": { current: 2, max: 2 } }],
    ["druid", { "1": { current: 2, max: 2 } }],
    ["warlock", { "1": { current: 1, max: 1 } }],
  ])("gives a level 1 %s its SRD slots", async (characterClass, expected) => {
    const res = await create(characterClass);

    expect(res.status).toBe(201);
    expect(createdSlots()).toEqual(expected);
  });

  it.each(["fighter", "paladin", "ranger"])("gives a level 1 %s none", async (characterClass) => {
    const res = await create(characterClass);

    expect(res.status).toBe(201);
    expect(createdSlots()).toBeUndefined();
  });
});
