/**
 * The second live spellcasting path.
 *
 * `POST /api/campaign/[id]/magic/cast` is authenticated, reachable and spends a
 * spell slot, and until this increment it enforced no armour-proficiency rule
 * at all — the gate existed only on the action route. "Backend code owns
 * mechanical truth" has no no-UI-caller exemption, so the refusal now lives in
 * `castSpell` itself, where every caller of the service inherits it.
 *
 * This file did not exist before: the endpoint had no tests. It follows the
 * mocking conventions of `tests/api/action-intent-contract.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/campaign/[id]/magic/cast/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    character: { findUnique: vi.fn(), update: vi.fn() },
    srdSpell: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "AuthError";
    }
  },
}));

const campaignId = "camp_1";
const characterId = "char_1";
const mockUser = { id: "user_1" };

/** Heavy armour, as a persisted `InventoryItem` row reads. */
const HEAVY_ARMOR = [
  {
    type: "armor",
    equippedSlot: "ARMOR",
    properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
  },
];

/** Light armour, which a cleric is proficient with. */
const LIGHT_ARMOR = [
  {
    type: "armor",
    equippedSlot: "ARMOR",
    properties: { baseAC: 11, armorClass: "light", addDexModifier: true },
  },
];

function mockCharacter(overrides: Record<string, unknown>) {
  (prisma.character.findUnique as any).mockResolvedValue({
    id: characterId,
    campaignId,
    spellSlots: { "1": { current: 2, max: 2 }, "3": { current: 2, max: 2 } },
    class: "wizard",
    inventory: [],
    ...overrides,
  });
}

async function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest(`http://localhost/api/campaign/${campaignId}/magic/cast`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: campaignId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as any).mockResolvedValue(mockUser);
  (prisma.campaign.findUnique as any).mockResolvedValue({
    id: campaignId,
    userId: mockUser.id,
    characterId,
    character: { id: characterId },
  });
  (prisma.srdSpell.findUnique as any).mockResolvedValue(null);
  (prisma.character.update as any).mockImplementation(
    async ({ data }: { data: { spellSlots: unknown } }) => ({
      id: characterId,
      spellSlots: data.spellSlots,
    })
  );
  mockCharacter({});
});

describe("POST /api/campaign/[id]/magic/cast enforces armour proficiency", () => {
  it("refuses a wizard in heavy armour and spends no slot", async () => {
    mockCharacter({ class: "wizard", inventory: HEAVY_ARMOR });

    const res = await post({ spellLevel: 1 });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("ARMOR_PROFICIENCY_REQUIRED");
    expect(body.error).toMatch(/armou?r/i);

    // The refusal lands before any resolution, so the slot survives it.
    expect(prisma.character.update).not.toHaveBeenCalled();
  });

  // The cantrip case (spellLevel 0) cannot be reached through this route: it
  // validates spellLevel as 1-9 before anything else. It is covered at the
  // service in tests/rules/magic-service-contract.test.ts.

  it("lets a cleric in light armour cast — the gate reads the class", async () => {
    // Same endpoint, same armour type slot, proficient wearer. Without this a
    // gate hard-coded to "armoured ⇒ refuse" would pass the refusal test.
    mockCharacter({ class: "cleric", inventory: LIGHT_ARMOR });

    const res = await post({ spellLevel: 1 });

    expect(res.status).toBe(200);
    expect(prisma.character.update).toHaveBeenCalled();
  });

  it("lets an unarmoured wizard cast", async () => {
    mockCharacter({ class: "wizard", inventory: [] });

    const res = await post({ spellLevel: 1 });

    expect(res.status).toBe(200);
  });
});
