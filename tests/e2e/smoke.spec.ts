import { expect, test } from "@playwright/test";

test("loads the app and renders character creation without submitting", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Dungeon Cortex/i);
  await expect(page.getByRole("heading", { name: "Dungeon Cortex" })).toBeVisible();

  const startLink = page.getByRole("link", { name: "Start your adventure" });
  await expect(startLink).toBeVisible();
  await expect(startLink).toHaveAttribute("href", "/character/create");

  await page.goto("/character/create");

  await expect(page).toHaveURL(/\/character\/create$/);
  await expect(page.getByRole("heading", { name: "Create Your Character" })).toBeVisible();
  await expect(page.getByLabel("Character Name")).toBeVisible();
  await expect(page.getByLabel("Race")).toBeVisible();
  await expect(page.getByLabel("Class")).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin Adventure" })).toBeVisible();
});