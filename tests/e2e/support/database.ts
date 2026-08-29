import { PrismaClient } from "@prisma/client";

export interface E2ECreatedRecords {
  campaignId?: string;
  characterId?: string;
}

function assertSafeE2EDatabase(): void {
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
      await prisma.gameLog.deleteMany({
        where: { campaignId: records.campaignId },
      });
      await prisma.campaign.deleteMany({
        where: { id: records.campaignId },
      });
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
