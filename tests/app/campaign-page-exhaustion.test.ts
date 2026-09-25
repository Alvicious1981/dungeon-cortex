/**
 * The campaign page shows the exhaustion the backend enforces: the indicator
 * receives the character's level, and the hit point bar and combat HUD are
 * measured against the maximum healing can actually reach (halved from
 * level 4), not the stored `maxHp`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement } from "react";

import CampaignPage from "@/app/campaign/[id]/page";
import ExhaustionIndicator from "@/components/character/ExhaustionIndicator";
import CombatHUDController from "@/components/combat/CombatHUDController";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findFirst: vi.fn() },
    memoryEntry: { findMany: vi.fn().mockResolvedValue([]) },
    quest: { findMany: vi.fn().mockResolvedValue([]) },
    nPC: { findMany: vi.fn().mockResolvedValue([]) },
    location: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  AuthError: class extends Error {},
}));

const params = Promise.resolve({ id: "camp_1" });

function campaignWith(exhaustionLevel: number, encounter = false) {
  return {
    id: "camp_1",
    userId: "user-1",
    title: "La Torre de Cristal",
    status: "active",
    gold: 0,
    currentLocationId: null,
    currentNodeId: null,
    character: {
      id: "char-1",
      name: "Mira",
      revision: 1,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      race: "Human",
      class: "Fighter",
      level: 1,
      hp: 8,
      maxHp: 20,
      xp: 0,
      exhaustionLevel,
      diedAt: null,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      spellSlots: null,
      concentrationSpellId: null,
      profile: null,
      inventory: [] as unknown[],
    },
    logs: [] as unknown[],
    encounters: encounter
      ? [
          {
            id: "enc-1",
            currentTurnIndex: 0,
            round: 1,
            combatants: [
              { id: "p1", name: "Mira", isPlayer: true, hp: 8, maxHp: 20, initiativeTotal: 12, conditions: [], deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null, x: 0, y: 0, size: "Medium" },
              { id: "g1", name: "Goblin", isPlayer: false, hp: 7, maxHp: 7, initiativeTotal: 10, conditions: [], deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null, x: 1, y: 0, size: "Small" },
            ],
          },
        ]
      : ([] as unknown[]),
  };
}

type Found = { props: Record<string, unknown> };

function findByType(node: unknown, target: unknown): Found | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByType(child, target);
      if (found) return found;
    }
    return null;
  }
  if (isValidElement(node)) {
    if ((node as { type: unknown }).type === target) return node as unknown as Found;
    return findByType((node as { props?: { children?: unknown } }).props?.children, target);
  }
  return null;
}

/** Every string and number the page tree renders directly, joined. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as { props?: { children?: unknown } }).props?.children);
  return "";
}

async function page(exhaustionLevel: number, encounter = false) {
  (prisma.campaign.findFirst as any).mockResolvedValue(campaignWith(exhaustionLevel, encounter));
  return CampaignPage({ params });
}

describe("campaign page — exhaustion on screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue({ id: "user-1" });
    (prisma.memoryEntry.findMany as any).mockResolvedValue([]);
    (prisma.quest.findMany as any).mockResolvedValue([]);
    (prisma.nPC.findMany as any).mockResolvedValue([]);
  });

  it("hands the character's exhaustion level to the indicator", async () => {
    const tree = await page(3);
    expect(findByType(tree, ExhaustionIndicator)?.props.exhaustionLevel).toBe(3);
  });

  it("measures the HP line against the halved maximum from level 4", async () => {
    const text = textOf(await page(4));
    expect(text).toContain(" / 10");
    expect(text).toContain("Máximo reducido por agotamiento (normal: 20)");
  });

  it("keeps the stored maximum below level 4", async () => {
    const text = textOf(await page(3));
    expect(text).toContain(" / 20");
    expect(text).not.toContain("Máximo reducido");
  });

  it("gives the combat HUD the player's halved maximum, and leaves enemies alone", async () => {
    const hud = findByType(await page(4, true), CombatHUDController);
    const combatants = hud?.props.combatants as Array<{ id: string; maxHp: number }>;
    expect(combatants.find((c) => c.id === "p1")?.maxHp).toBe(10);
    expect(combatants.find((c) => c.id === "g1")?.maxHp).toBe(7);
  });
});
