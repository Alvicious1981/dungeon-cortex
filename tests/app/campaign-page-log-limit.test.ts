import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement } from "react";

import CampaignPage from "@/app/campaign/[id]/page";
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
  AuthError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "AuthError";
    }
  },
}));

const params = Promise.resolve({ id: "camp_1" });

const baseCharacter = {
  id: "char-1",
  name: "Mira",
  revision: 1,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  race: "Human",
  class: "Fighter",
  level: 1,
  hp: 10,
  maxHp: 10,
  xp: 0,
  stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  spellSlots: null,
  concentrationSpellId: null,
  profile: null,
  inventory: [] as unknown[],
};

function buildCampaign(logs: Array<{ id: string; role: string; content: string; createdAt: Date }>) {
  return {
    id: "camp_1",
    userId: "user-1",
    title: "La Torre de Cristal",
    status: "active",
    gold: 0,
    currentLocationId: null,
    currentNodeId: null,
    character: baseCharacter,
    logs,
    encounters: [] as unknown[],
  };
}

/** Depth-first walk of a React element tree, collecting string leaves that match `pattern`, in render order. */
function collectMatchingStrings(node: unknown, pattern: RegExp, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "number") {
    return out;
  }
  if (typeof node === "string") {
    if (pattern.test(node)) out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectMatchingStrings(child, pattern, out);
    return out;
  }
  if (isValidElement(node)) {
    collectMatchingStrings((node as { props?: { children?: unknown } }).props?.children, pattern, out);
    return out;
  }
  return out;
}

describe("campaign page — bounded initial log history (DC-AUD-005)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue({ id: "user-1" });
    (prisma.memoryEntry.findMany as any).mockResolvedValue([]);
    (prisma.quest.findMany as any).mockResolvedValue([]);
    (prisma.nPC.findMany as any).mockResolvedValue([]);
  });

  it("requests at most the 50 most recent logs (desc order, take: 50)", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(buildCampaign([]));

    await CampaignPage({ params });

    expect(prisma.campaign.findFirst).toHaveBeenCalledTimes(1);
    const callArgs = (prisma.campaign.findFirst as any).mock.calls[0][0];
    expect(callArgs.include.logs).toEqual({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  it("renders a short history (<50) fully, in chronological order, newest entry included", async () => {
    // Mimic what a real `orderBy: desc, take: 50` query returns: newest first.
    const logsDesc = [
      { id: "log-3", role: "assistant", content: "entry-newest", createdAt: new Date("2026-01-01T00:02:00.000Z") },
      { id: "log-2", role: "user", content: "entry-mid", createdAt: new Date("2026-01-01T00:01:00.000Z") },
      { id: "log-1", role: "assistant", content: "entry-oldest", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    ];
    (prisma.campaign.findFirst as any).mockResolvedValue(buildCampaign(logsDesc));

    const tree = await CampaignPage({ params });

    const rendered = collectMatchingStrings(tree, /^entry-/);
    // All three present (short campaign keeps everything) and re-ordered oldest → newest for display.
    expect(rendered).toEqual(["entry-oldest", "entry-mid", "entry-newest"]);
  });

  it("shows the empty-history state when the campaign has zero logs", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(buildCampaign([]));

    const tree = await CampaignPage({ params });

    const emptyState = collectMatchingStrings(tree, /Aún no hay entradas/);
    expect(emptyState).toHaveLength(1);
  });
});
