import { randomUUID } from "node:crypto";
import { expect, test, type Response } from "@playwright/test";

import {
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

async function createdId(response: Response): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

test("@smoke crea un héroe, abre una campaña, actúa y la retoma", async ({
  page,
}) => {
  test.setTimeout(90_000);

  const created: E2ECreatedRecords = {};
  const pageErrors: Error[] = [];
  const characterName = `E2E ${randomUUID().slice(0, 8)}`;
  const campaignTitle = `Crónica de ${characterName}`;

  page.on("pageerror", (error) => pageErrors.push(error));

  try {
    await page.goto("/");
    await page.getByRole("link", { name: "Crear personaje" }).click();

    await expect(page).toHaveURL(/\/character\/create$/);
    await page.getByLabel("Nombre del personaje").fill(characterName);
    await expect(page.getByLabel("Linaje")).not.toHaveValue("");
    await expect(page.getByLabel("Clase")).not.toHaveValue("");

    const characterResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/character") &&
        response.request().method() === "POST"
    );
    const campaignResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/campaign") &&
        response.request().method() === "POST"
    );

    await page.getByRole("button", { name: "Comenzar aventura" }).click();

    created.characterId = await createdId(await characterResponsePromise);
    created.campaignId = await createdId(await campaignResponsePromise);

    await expect(page).toHaveURL(
      new RegExp(`/campaign/${created.campaignId}$`)
    );
    await expect(
      page.getByRole("heading", { name: campaignTitle })
    ).toBeVisible();
    await expect(page.getByLabel(/^Hit points:/)).toBeVisible();
    await expect(page.getByLabel("Tu acción")).toBeVisible();

    const actionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/campaign/${created.campaignId}/action`) &&
        response.request().method() === "POST"
    );
    await page.getByLabel("Tu acción").fill("/roll 1d20");
    await page.getByRole("button", { name: "Actuar" }).click();

    const actionResponse = await actionResponsePromise;
    expect(actionResponse.status()).toBe(202);

    const chronicle = page.getByRole("region", {
      name: "Bitácora de aventura",
    });
    await expect(chronicle.getByText("/roll 1d20", { exact: true })).toBeVisible();
    await expect(chronicle.getByText(/Roll 1d20:/)).toBeVisible();

    await page.goto("/campaigns");
    await expect(
      page.getByRole("heading", { name: "Tus campañas" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: campaignTitle })
    ).toBeVisible();

    const resumeLink = page.getByRole("link", { name: "Continuar campaña" });
    await expect(resumeLink).toHaveAttribute(
      "href",
      `/campaign/${created.campaignId}`
    );
    await resumeLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/campaign/${created.campaignId}$`)
    );
    await expect(pageErrors).toEqual([]);
  } finally {
    await cleanupE2ERecords(created);
  }
});
