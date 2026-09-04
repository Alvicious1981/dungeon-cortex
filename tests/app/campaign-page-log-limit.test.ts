import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement } from "react";

import CampaignPage from "@/app/campaign/[id]/page";
import StoryLog from "@/app/campaign/[id]/StoryLog";
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

/** Newest-first fixture of `count` GameLog rows, ids/timestamps descending
 *  from `count` down to `1` — exactly the shape a real
 *  `orderBy: [{createdAt:"desc"},{id:"desc"}]` query would hand back. */
function logsDescFixture(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = count - i;
    return {
      id: `log-${n}`,
      role: n % 2 === 0 ? "assistant" : "user",
      content: `entry-${n}`,
      createdAt: new Date(2026, 0, 1, 0, n),
    };
  });
}

/** Depth-first walk of a React element tree, locating the first element
 *  whose `type` is exactly `target` (identity comparison — safe here since
 *  StoryLog is a plain, unrendered function reference until this element
 *  tree is actually mounted). */
function findElementByType(node: unknown, target: unknown): { props: Record<string, unknown> } | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByType(child, target);
      if (found) return found;
    }
    return null;
  }
  if (isValidElement(node)) {
    if ((node as { type: unknown }).type === target) {
      return node as unknown as { props: Record<string, unknown> };
    }
    return findElementByType((node as { props?: { children?: unknown } }).props?.children, target);
  }
  return null;
}

describe("campaign page — bounded initial log history (DC-AUD-005 / DC-AUD-006)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue({ id: "user-1" });
    (prisma.memoryEntry.findMany as any).mockResolvedValue([]);
    (prisma.quest.findMany as any).mockResolvedValue([]);
    (prisma.nPC.findMany as any).mockResolvedValue([]);
  });

  it("requests a 51-row sentinel using the total order (createdAt DESC, id DESC)", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(buildCampaign([]));

    await CampaignPage({ params });

    expect(prisma.campaign.findFirst).toHaveBeenCalledTimes(1);
    const callArgs = (prisma.campaign.findFirst as any).mock.calls[0][0];
    expect(callArgs.include.logs).toEqual({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
    });
  });

  it("delivers exactly 50 logs and initialHasMore:true to StoryLog when the sentinel row (51) comes back", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(buildCampaign(logsDescFixture(51)));

    const tree = await CampaignPage({ params });
    const storyLog = findElementByType(tree, StoryLog);

    expect(storyLog).not.toBeNull();
    const initialLogs = storyLog!.props.initialLogs as Array<{ id: string; createdAt: string }>;
    expect(initialLogs).toHaveLength(50);
    expect(storyLog!.props.initialHasMore).toBe(true);

    // The sentinel (the oldest row, log-1) must never reach the client.
    expect(initialLogs.some((l) => l.id === "log-1")).toBe(false);

    // Chronological order for presentation: oldest-of-the-50 first.
    expect(initialLogs[0].id).toBe("log-2");
    expect(initialLogs[49].id).toBe("log-51");

    // createdAt normalized to an ISO string before crossing into the Client Component.
    expect(typeof initialLogs[0].createdAt).toBe("string");
    expect(initialLogs[0].createdAt).toBe(new Date(2026, 0, 1, 0, 2).toISOString());
  });

  it("delivers all 50 logs and initialHasMore:false for a campaign with exactly 50", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(buildCampaign(logsDescFixture(50)));

    const tree = await CampaignPage({ params });
    const storyLog = findElementByType(tree, StoryLog);

    const initialLogs = storyLog!.props.initialLogs as Array<{ id: string }>;
    expect(initialLogs).toHaveLength(50);
    expect(storyLog!.props.initialHasMore).toBe(false);
    expect(initialLogs[0].id).toBe("log-1");
    expect(initialLogs[49].id).toBe("log-50");
  });

  it("delivers a short history (<50) fully, in chronological order, initialHasMore:false", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(buildCampaign(logsDescFixture(3)));

    const tree = await CampaignPage({ params });
    const storyLog = findElementByType(tree, StoryLog);

    const initialLogs = storyLog!.props.initialLogs as Array<{ id: string }>;
    expect(initialLogs.map((l) => l.id)).toEqual(["log-1", "log-2", "log-3"]);
    expect(storyLog!.props.initialHasMore).toBe(false);
  });

  it("delivers an empty array and initialHasMore:false when the campaign has zero logs", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(buildCampaign([]));

    const tree = await CampaignPage({ params });
    const storyLog = findElementByType(tree, StoryLog);

    expect(storyLog!.props.initialLogs).toEqual([]);
    expect(storyLog!.props.initialHasMore).toBe(false);
  });
});
