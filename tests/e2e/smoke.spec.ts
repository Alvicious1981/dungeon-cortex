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

test("keeps onboarding usable across desktop, laptop, tablet and mobile", async ({ page }) => {
  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "laptop", width: 1024, height: 768 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    const startLink = page.getByRole("link", { name: "Start your adventure" });
    await expect(startLink, `${viewport.name}: start link`).toBeVisible();
    const startBox = await startLink.boundingBox();
    expect(startBox?.height, `${viewport.name}: start target`).toBeGreaterThanOrEqual(44);

    await page.goto("/character/create");
    const beginButton = page.getByRole("button", { name: "Begin Adventure" });
    await expect(beginButton, `${viewport.name}: begin button`).toBeVisible();
    const beginBox = await beginButton.boundingBox();
    expect(beginBox?.height, `${viewport.name}: begin target`).toBeGreaterThanOrEqual(44);

    await page.getByLabel("Character Name").fill("Seraphina Nightvale of the Unbroken Chronicle and Northern Watch");
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(layout.scrollWidth, `${viewport.name}: horizontal overflow`).toBe(layout.clientWidth);
  }
});

test("respects reduced motion in the global interaction system", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const transitionDuration = await page.getByRole("link", { name: "Start your adventure" }).evaluate(
    (element) => getComputedStyle(element).transitionDuration
  );
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.00001);
});
