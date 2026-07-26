import { expect, test } from "@playwright/test";

test("carga la portada y muestra la creación sin enviar datos", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Dungeon Cortex/i);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    page.getByRole("heading", { name: "Tu intención mueve la historia." })
  ).toBeVisible();

  const startLink = page.getByRole("link", { name: "Crear personaje" });
  await expect(startLink).toBeVisible();
  await expect(startLink).toHaveAttribute("href", "/character/create");

  await page.goto("/character/create");

  await expect(page).toHaveURL(/\/character\/create$/);
  await expect(
    page.getByRole("heading", { name: "Crea tu personaje" })
  ).toBeVisible();
  await expect(page.getByLabel("Nombre del personaje")).toBeVisible();
  await expect(page.getByLabel("Linaje")).toBeVisible();
  await expect(page.getByLabel("Clase")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Comenzar aventura" })
  ).toBeVisible();
});

test("mantiene el onboarding usable en escritorio, portátil, tablet y móvil", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "laptop", width: 1024, height: 768 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/");

    const startLink = page.getByRole("link", { name: "Crear personaje" });
    await expect(startLink, `${viewport.name}: enlace de inicio`).toBeVisible();
    const startBox = await startLink.boundingBox();
    expect(
      startBox?.height,
      `${viewport.name}: target de inicio`
    ).toBeGreaterThanOrEqual(44);

    await page.goto("/character/create");
    const beginButton = page.getByRole("button", {
      name: "Comenzar aventura",
    });
    await expect(
      beginButton,
      `${viewport.name}: botón de inicio`
    ).toBeVisible();
    const beginBox = await beginButton.boundingBox();
    expect(
      beginBox?.height,
      `${viewport.name}: target de formulario`
    ).toBeGreaterThanOrEqual(44);

    await page
      .getByLabel("Nombre del personaje")
      .fill(
        "Serafina de la Guardia Septentrional y la Crónica Inquebrantable"
      );
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(layout.scrollWidth, `${viewport.name}: overflow horizontal`).toBe(
      layout.clientWidth
    );
  }
});

test("respeta la reducción de movimiento del sistema", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const transitionDuration = await page
    .getByRole("link", { name: "Crear personaje" })
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.00001);
});
