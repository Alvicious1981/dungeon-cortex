import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  PrismaClient: vi.fn(),
  gameLogDeleteMany: vi.fn(),
  campaignDeleteMany: vi.fn(),
  inventoryItemDeleteMany: vi.fn(),
  characterDeleteMany: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return {
    ...actual,
    PrismaClient: prismaMocks.PrismaClient,
  };
});

import { cleanupE2ERecords } from "../e2e/support/database";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function foreignKeyViolation(constraint: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `Foreign key constraint violated on the constraint: \`${constraint}\``,
    {
      code: "P2003",
      clientVersion: "6.19.2",
      meta: { modelName: "Campaign", constraint },
    }
  );
}

describe("cleanupE2ERecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("E2E_TEST_MODE", "true");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@127.0.0.1:55432/dungeon_cortex_e2e"
    );

    prismaMocks.PrismaClient.mockImplementation(function () {
      return {
        gameLog: { deleteMany: prismaMocks.gameLogDeleteMany },
        campaign: { deleteMany: prismaMocks.campaignDeleteMany },
        inventoryItem: { deleteMany: prismaMocks.inventoryItemDeleteMany },
        character: { deleteMany: prismaMocks.characterDeleteMany },
        $disconnect: prismaMocks.disconnect,
      };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("re-deletes a late assistant log and removes only the journey records", async () => {
    const targetCampaignId = "created-campaign";
    const targetCharacterId = "created-character";
    const campaignDeleteStarted = deferred();
    const mayAttemptCampaignDelete = deferred();
    const state = {
      campaignIds: new Set([targetCampaignId, "unrelated-campaign"]),
      characterIds: new Set([targetCharacterId, "unrelated-character"]),
      logs: [
        { id: "initial-log", campaignId: targetCampaignId },
        { id: "unrelated-log", campaignId: "unrelated-campaign" },
      ],
      inventory: [
        { id: "created-item", characterId: targetCharacterId },
        { id: "unrelated-item", characterId: "unrelated-character" },
      ],
    };
    let campaignDeleteAttempts = 0;

    prismaMocks.gameLogDeleteMany.mockImplementation(async ({ where }) => {
      state.logs = state.logs.filter((row) => row.campaignId !== where.campaignId);
    });
    prismaMocks.campaignDeleteMany.mockImplementation(async ({ where }) => {
      campaignDeleteAttempts += 1;
      if (campaignDeleteAttempts === 1) {
        campaignDeleteStarted.resolve();
        await mayAttemptCampaignDelete.promise;
      }
      if (state.logs.some((row) => row.campaignId === where.id)) {
        throw foreignKeyViolation("GameLog_campaignId_fkey");
      }
      state.campaignIds.delete(where.id);
    });
    prismaMocks.inventoryItemDeleteMany.mockImplementation(async ({ where }) => {
      state.inventory = state.inventory.filter(
        (row) => row.characterId !== where.characterId
      );
    });
    prismaMocks.characterDeleteMany.mockImplementation(async ({ where }) => {
      state.characterIds.delete(where.id);
    });

    const cleanup = cleanupE2ERecords({
      campaignId: targetCampaignId,
      characterId: targetCharacterId,
    });
    await campaignDeleteStarted.promise;

    state.logs.push({ id: "late-assistant-log", campaignId: targetCampaignId });
    mayAttemptCampaignDelete.resolve();

    await cleanup;

    expect(state).toEqual({
      campaignIds: new Set(["unrelated-campaign"]),
      characterIds: new Set(["unrelated-character"]),
      logs: [{ id: "unrelated-log", campaignId: "unrelated-campaign" }],
      inventory: [
        { id: "unrelated-item", characterId: "unrelated-character" },
      ],
    });
    expect(prismaMocks.gameLogDeleteMany).toHaveBeenCalledTimes(2);
    expect(prismaMocks.campaignDeleteMany).toHaveBeenCalledTimes(2);
    expect(prismaMocks.disconnect).toHaveBeenCalledOnce();
  });

  it("bounds the known late-log retry to one extra attempt", async () => {
    const error = foreignKeyViolation("GameLog_campaignId_fkey");
    prismaMocks.gameLogDeleteMany.mockResolvedValue({ count: 0 });
    prismaMocks.campaignDeleteMany.mockRejectedValue(error);

    await expect(
      cleanupE2ERecords({ campaignId: "created-campaign" })
    ).rejects.toBe(error);

    expect(prismaMocks.gameLogDeleteMany).toHaveBeenCalledTimes(2);
    expect(prismaMocks.campaignDeleteMany).toHaveBeenCalledTimes(2);
  });

  it("rethrows unrelated foreign-key violations without retrying", async () => {
    const error = foreignKeyViolation("MemoryEntry_campaignId_fkey");
    prismaMocks.gameLogDeleteMany.mockResolvedValue({ count: 0 });
    prismaMocks.campaignDeleteMany.mockRejectedValue(error);

    await expect(
      cleanupE2ERecords({ campaignId: "created-campaign" })
    ).rejects.toBe(error);

    expect(prismaMocks.gameLogDeleteMany).toHaveBeenCalledOnce();
    expect(prismaMocks.campaignDeleteMany).toHaveBeenCalledOnce();
  });

  it("still refuses cleanup without the explicit E2E mode gate", async () => {
    vi.stubEnv("E2E_TEST_MODE", "false");

    await expect(
      cleanupE2ERecords({ campaignId: "created-campaign" })
    ).rejects.toThrow("Refusing E2E database access without E2E_TEST_MODE=true.");
    expect(prismaMocks.PrismaClient).not.toHaveBeenCalled();
  });

  it("still refuses cleanup when the database name is not disposable", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@127.0.0.1:5432/dungeon_cortex"
    );

    await expect(
      cleanupE2ERecords({ campaignId: "created-campaign" })
    ).rejects.toThrow(
      'Refusing E2E database access to "dungeon_cortex"; the database name must contain an e2e or test segment.'
    );
    expect(prismaMocks.PrismaClient).not.toHaveBeenCalled();
  });
});
