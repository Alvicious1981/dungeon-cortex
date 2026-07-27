/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CampaignMobileNav from "@/components/campaign/CampaignMobileNav";
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
    render(<CampaignMobileNav />);
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
    expect(screen.getByRole("link", { name: "Personaje" })).toHaveAttribute(
      "href",
      "#character"
    );
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
