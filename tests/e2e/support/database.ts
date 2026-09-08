import { Prisma, PrismaClient } from "@prisma/client";

export interface E2ECreatedRecords {
  campaignId?: string;
  characterId?: string;
}

export function assertSafeE2EDatabase(): void {
  if (process.env.E2E_TEST_MODE !== "true") {
    throw new Error(
      "Refusing E2E database access without E2E_TEST_MODE=true."
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for data-backed E2E tests.");
  }

  let databaseName: string;
  try {
    const parsed = new URL(databaseUrl);
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!/(^|[_-])(e2e|test)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      `Refusing E2E database access to \"${databaseName}\"; the database name must contain an e2e or test segment.`
    );
  }
}

function isLateGameLogCleanupRace(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2003") return false;

  const meta = error.meta as
    | { modelName?: unknown; constraint?: unknown }
    | undefined;

  return (
    meta?.modelName === "Campaign" &&
    meta.constraint === "GameLog_campaignId_fkey"
  );
}

async function deleteCampaignRecords(
  prisma: PrismaClient,
  campaignId: string
): Promise<void> {
  // The action route can persist its assistant GameLog from Next's after(...)
  // hook after the first deleteMany has completed. Retry this exact FK race
  // once, re-deleting logs before the second campaign-delete attempt.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await prisma.gameLog.deleteMany({ where: { campaignId } });

    try {
      await prisma.campaign.deleteMany({ where: { id: campaignId } });
      return;
    } catch (error) {
      if (attempt === 1 || !isLateGameLogCleanupRace(error)) throw error;
    }
  }
}

/**
 * Deletes only the records created by one browser journey. The private-mode
 * user is intentionally retained because the application owns that singleton.
 */
export async function cleanupE2ERecords(
  records: E2ECreatedRecords
): Promise<void> {
  if (!records.campaignId && !records.characterId) return;

  assertSafeE2EDatabase();
  const prisma = new PrismaClient();

  try {
    if (records.campaignId) {
      await deleteCampaignRecords(prisma, records.campaignId);
    }

    if (records.characterId) {
      await prisma.inventoryItem.deleteMany({
        where: { characterId: records.characterId },
      });
      await prisma.character.deleteMany({
        where: { id: records.characterId },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
