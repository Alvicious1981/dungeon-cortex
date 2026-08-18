import { describe, it, expect, vi, beforeEach } from "vitest";

import CampaignsPage from "@/app/campaigns/page";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { notFound } from "next/navigation";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { campaign: { findMany: vi.fn() } },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "AuthError";
    }
  },
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const USER = { id: "user_1" };

const campaign = (over: Record<string, unknown> = {}) => ({
  id: "camp_1",
  title: "Crónica de Mira",
  status: "active",
  updatedAt: new Date("2026-08-05T10:00:00Z"),
  character: { name: "Mira", class: "barbarian", level: 3 },
  ...over,
});

/**
 * Renderiza el árbol a HTML estático. Hace falta renderizar de verdad: el texto
 * de las tarjetas vive dentro de componentes que no se ejecutan si solo se
 * inspeccionan las props.
 */
async function renderToHtml(node: unknown): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(node as never);
}

/** Texto visible, sin etiquetas, para aserciones legibles. */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Destinos de todos los enlaces del HTML renderizado. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

describe("biblioteca de campañas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(USER);
  });

  it("consulta solo las campañas del usuario, de la más reciente a la más antigua", async () => {
    (prisma.campaign.findMany as any).mockResolvedValue([campaign()]);

    await CampaignsPage();

    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER.id },
        orderBy: { updatedAt: "desc" },
      })
    );
  });

  it("no pide campos sin contrato de listado estable", async () => {
    (prisma.campaign.findMany as any).mockResolvedValue([campaign()]);

    await CampaignsPage();

    const { select } = (prisma.campaign.findMany as any).mock.calls[0][0];
    expect(select).not.toHaveProperty("gold");
    expect(select).not.toHaveProperty("currentLocationId");
    expect(select).not.toHaveProperty("currentNodeId");
  });

  it("muestra cada campaña con su personaje y un enlace para continuarla", async () => {
    (prisma.campaign.findMany as any).mockResolvedValue([campaign()]);

    const html = await renderToHtml(await CampaignsPage());

    expect(visibleText(html)).toContain("Crónica de Mira");
    expect(visibleText(html)).toContain("barbarian");
    expect(hrefs(html)).toContain("/campaign/camp_1");
  });

  it("deja visible pero sin enlace una campaña que no está activa", async () => {
    (prisma.campaign.findMany as any).mockResolvedValue([
      campaign({ status: "archived" }),
    ]);

    const html = await renderToHtml(await CampaignsPage());

    // La campaña se sigue viendo, con el motivo a la vista, pero no se puede abrir.
    expect(visibleText(html)).toContain("no está activa");
    expect(hrefs(html)).not.toContain("/campaign/camp_1");
  });

  it("ofrece crear personaje cuando todavía no hay ninguna campaña", async () => {
    (prisma.campaign.findMany as any).mockResolvedValue([]);

    const html = await renderToHtml(await CampaignsPage());

    expect(visibleText(html)).toContain("Todavía no hay ninguna campaña");
    expect(hrefs(html)).toContain("/character/create");
  });

  it("explica la falta de sesión en lugar de devolver un 404 mudo", async () => {
    const { AuthError } = await import("@/lib/auth/session");
    (getAuthUser as any).mockRejectedValue(new AuthError("Not authenticated."));

    const html = await renderToHtml(await CampaignsPage());

    // A diferencia de /campaign/[id], aquí no hay recurso que ocultar.
    expect(notFound).not.toHaveBeenCalled();
    expect(visibleText(html)).toContain("No hay sesión disponible");
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
  });

  it("propaga cualquier error que no sea de autenticación", async () => {
    (getAuthUser as any).mockRejectedValue(new Error("database connection lost"));

    await expect(CampaignsPage()).rejects.toThrow("database connection lost");
    expect(notFound).not.toHaveBeenCalled();
  });
});
