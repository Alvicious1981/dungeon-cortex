import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const PRIVATE_USER_ID = "00000000-0000-0000-0000-000000000000";
const hasDevelopmentDatabase = Boolean(
  process.env.DATABASE_URL && process.env.DIRECT_URL
);
const prisma = new PrismaClient();

test.describe("authenticated full-session flow", () => {
  test.setTimeout(120_000);

  test.skip(
    !hasDevelopmentDatabase,
    "DATABASE_URL and DIRECT_URL are required for the authenticated session E2E."
  );

  let campaignId: string | undefined;
  let characterId: string | undefined;

  test.afterEach(async () => {
    if (campaignId) {
      await prisma.$transaction([
        prisma.gameEventRecord.deleteMany({ where: { campaignId } }),
        prisma.actionRequest.deleteMany({ where: { campaignId } }),
        prisma.gameSession.deleteMany({ where: { campaignId } }),
        prisma.gameLog.deleteMany({ where: { campaignId } }),
        prisma.campaign.deleteMany({ where: { id: campaignId } }),
      ]);
    }
    if (characterId) {
      await prisma.$transaction([
        prisma.inventoryItem.deleteMany({ where: { characterId } }),
        prisma.character.deleteMany({ where: { id: characterId } }),
      ]);
    }
    campaignId = undefined;
    characterId = undefined;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("creates, pauses, resumes, and completes a private-user session with a durable ledger", async ({ page }) => {
    const characterName = `E2E Sentinel ${Date.now()}`;

    await page.goto("/character/create");
    await page.getByLabel("Nombre del personaje").fill(characterName);
    await page.getByLabel("Linaje").selectOption("human");
    await page.getByLabel("Clase").selectOption("fighter");

    const characterResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/character") &&
        response.request().method() === "POST",
      { timeout: 30_000 }
    );
    const campaignResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/campaign") &&
        response.request().method() === "POST",
      { timeout: 30_000 }
    );
    await page.getByRole("button", { name: "Comenzar aventura" }).click();

    const characterResponse = await characterResponsePromise;
    expect(characterResponse.status()).toBe(201);
    const characterPayload = (await characterResponse.json()) as { id?: string };
    characterId = characterPayload.id;
    expect(characterId).toBeTruthy();

    const campaignResponse = await campaignResponsePromise;
    expect(campaignResponse.status()).toBe(201);
    const campaignPayload = (await campaignResponse.json()) as { id?: string };
    campaignId = campaignPayload.id;
    expect(campaignId).toBeTruthy();

    await expect(page).toHaveURL(`/campaign/${campaignId}`, {
      timeout: 30_000,
    });

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { userId: true, characterId: true },
    });
    expect(campaign.characterId).toBe(characterId);
    expect(campaign.userId).toBe(PRIVATE_USER_ID);

    const sessionState = page.getByLabel("Session state");
    await expect(sessionState).toContainText("Session 1 · preparing", {
      ignoreCase: true,
    });

    const actionResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/campaign/${campaignId}/action`) &&
        response.request().method() === "POST"
    );
    await page.getByLabel("Tu acción").fill("I inspect the chamber.");
    await page.getByRole("button", { name: "Actuar", exact: true }).click();
    expect((await actionResponse).status()).toBe(200);

    await expect(sessionState).toContainText("narrative", { ignoreCase: true });

    const pauseResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/campaign/${campaignId}/session`) &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    expect((await pauseResponse).status()).toBe(200);
    await expect(sessionState).toContainText("paused", { ignoreCase: true });

    const resumeResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/campaign/${campaignId}/session`) &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    expect((await resumeResponse).status()).toBe(200);
    await expect(sessionState).toContainText("narrative", { ignoreCase: true });

    page.once("dialog", (dialog) => dialog.accept());
    const completeResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/campaign/${campaignId}/session`) &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "End session", exact: true }).click();
    expect((await completeResponse).status()).toBe(200);
    await expect(sessionState).toContainText("completed", { ignoreCase: true });

    await expect.poll(async () => {
      return prisma.gameLog.count({
        where: { campaignId, role: "assistant" },
      });
    }).toBeGreaterThanOrEqual(1);

    const persistedSession = await prisma.gameSession.findFirstOrThrow({
      where: { campaignId },
      include: {
        actionRequests: true,
        events: { orderBy: { sequence: "asc" } },
      },
    });

    expect(persistedSession.status).toBe("COMPLETED");
    expect(persistedSession.mode).toBe("COMPLETED");
    expect(persistedSession.summary).toContain(characterName);
    expect(persistedSession.actionRequests).toHaveLength(1);
    expect(persistedSession.actionRequests[0]?.status).toBe("COMPLETED");
    expect(persistedSession.events.map((event) => event.type)).toEqual([
      "ACTION_ACCEPTED",
      "SESSION_PAUSED",
      "SESSION_RESUMED",
      "SESSION_COMPLETED",
    ]);
    expect(persistedSession.events.map((event) => event.sequence)).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
