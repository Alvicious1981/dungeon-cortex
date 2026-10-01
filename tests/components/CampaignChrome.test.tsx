/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CampaignLayout from "@/components/campaign/CampaignLayout";
import { DUNGEON_OPEN_CHARACTER, prepareDungeonAction } from "@/lib/events/campaign-ui";
import { act } from "@testing-library/react";
import CampaignLoading from "@/app/campaign/[id]/loading";
import CampaignError from "@/app/campaign/[id]/error";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("campaign chrome", () => {
  it("enlaza cada área móvil con una sección existente", () => {
    const scroll = vi.fn();
    const oldScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    render(
      <CampaignLayout character={<aside id="character">Estado</aside>} journal={<aside id="journal" tabIndex={-1}>Misiones</aside>}>
        <section id="scene" tabIndex={-1}>Mapa</section>
        <section id="chronicle" tabIndex={-1}>Relato</section>
      </CampaignLayout>
    );
    const navigation = screen.getByRole("navigation", {
      name: "Áreas de campaña",
    });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Escena" })).toHaveAttribute(
      "href",
      "#scene"
    );
    expect(screen.getByRole("link", { name: "Bitácora" })).toHaveAttribute(
      "href",
      "#chronicle"
    );
    const openSheet = vi.fn();
    window.addEventListener(DUNGEON_OPEN_CHARACTER, openSheet);
    fireEvent.click(screen.getByRole("button", { name: "Personaje" }));
    expect(openSheet).toHaveBeenCalledOnce();
    window.removeEventListener(DUNGEON_OPEN_CHARACTER, openSheet);
    fireEvent.click(screen.getByRole("link", { name: "Diario" }));
    expect(document.querySelector(".dc-campaign-layout")).toHaveAttribute("data-mobile-area", "journal");
    act(() => prepareDungeonAction("equipar Daga"));
    expect(document.querySelector(".dc-campaign-layout")).toHaveAttribute("data-mobile-area", "adventure");
    fireEvent.click(screen.getByRole("link", { name: "Bitácora" }));
    expect(document.querySelector(".dc-campaign-layout")).toHaveAttribute("data-mobile-area", "adventure");
    fireEvent.click(screen.getByRole("button", { name: "Estado" }));
    expect(document.querySelector(".dc-campaign-layout")).toHaveAttribute("data-auxiliary", "character");
    HTMLElement.prototype.scrollIntoView = oldScroll;
    expect(screen.getByRole("link", { name: "Diario" })).toHaveAttribute(
      "href",
      "#journal"
    );
  });

  it("anuncia la carga de campaña sin depender de la animación", () => {
    render(<CampaignLoading />);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Abriendo campaña…")).toBeInTheDocument();
  });

  it("ofrece reintento y salida segura ante un error recuperable", () => {
    const reset = vi.fn();
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    render(<CampaignError error={new Error("Unavailable")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("link", { name: "Volver al inicio" })
    ).toHaveAttribute("href", "/");
    consoleSpy.mockRestore();
  });
});
