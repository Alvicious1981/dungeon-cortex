/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CampaignMobileNav from "@/components/campaign/CampaignMobileNav";
import CampaignLoading from "@/app/campaign/[id]/loading";
import CampaignError from "@/app/campaign/[id]/error";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("campaign chrome", () => {
  it("links every mobile campaign area to an existing section contract", () => {
    render(<CampaignMobileNav />);
    const navigation = screen.getByRole("navigation", { name: "Campaign areas" });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scene" })).toHaveAttribute("href", "#scene");
    expect(screen.getByRole("link", { name: "Chronicle" })).toHaveAttribute("href", "#chronicle");
    expect(screen.getByRole("link", { name: "Character" })).toHaveAttribute("href", "#character");
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute("href", "#journal");
  });

  it("announces campaign loading without relying on animation", () => {
    render(<CampaignLoading />);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Opening campaign…")).toBeInTheDocument();
  });

  it("offers a retry and a safe exit from a recoverable campaign error", () => {
    const reset = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<CampaignError error={new Error("Unavailable")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Leave campaign" })).toHaveAttribute("href", "/");
    consoleSpy.mockRestore();
  });
});
