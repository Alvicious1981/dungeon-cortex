/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import SpoilsOfWar from "@/components/combat/SpoilsOfWar";
import type { LootPayload } from "@/lib/rules/loot";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mundanePayload: LootPayload = {
  gold: 12,
  mundaneItems: [
    {
      name: "Tarnished copper bracelet",
      type: "misc",
      rarity: "mundane",
      description: "A thin band of hammered copper, green with age.",
      properties: {},
      valueGP: 1,
    },
    {
      name: "Cracked leather satchel",
      type: "misc",
      rarity: "mundane",
      description: "Sun-faded and split at the seams.",
      properties: {},
      valueGP: 2,
    },
  ],
  magicItems: [],
  totalValue: 15,
  rarityBracket: "mundane",
  flavorText: "Pockets picked clean. A few coins and dust.",
};

const rarePayload: LootPayload = {
  gold: 250,
  mundaneItems: [
    {
      name: "Notched hunting knife",
      type: "weapon",
      rarity: "mundane",
      description: "The blade is chipped near the tip from cutting through bone.",
      properties: {},
      valueGP: 3,
    },
  ],
  magicItems: [
    {
      name: "Blade of Bitter Resolve",
      type: "weapon",
      rarity: "rare",
      description: "A single-edged sword whose blade darkens when drawn in anger.",
      properties: { damageDice: "1d8", damageBonus: 1, damageType: "slashing" },
      valueGP: 500,
    },
  ],
  totalValue: 753,
  rarityBracket: "rare",
  flavorText: "The air around the corpse hums with faint energy.",
};

const legendaryPayload: LootPayload = {
  gold: 800,
  mundaneItems: [],
  magicItems: [
    {
      name: "The Hollow Crown",
      type: "misc",
      rarity: "legendary",
      description: "A circlet of bone-white metal. The wearer hears whispers.",
      properties: { effect: "wisdom_advantage", curse: "whispers" },
      valueGP: 10000,
    },
  ],
  totalValue: 10800,
  rarityBracket: "legendary",
  flavorText: "A weight settles on your soul before your hand touches it.",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpoilsOfWar — structure and ARIA", () => {
  it("renders the dialog container with correct ARIA attributes", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("has a visible heading", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /spoils of war/i })
    ).toBeInTheDocument();
  });

  it("renders the 'Claim & Continue' button", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /claim/i })
    ).toBeInTheDocument();
  });
});

describe("SpoilsOfWar — gold display", () => {
  it("displays the gold amount", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it("displays a gold label (GP or Gold Pieces)", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    // Flexible: accepts "Gold Pieces" or "GP"
    const goldText = screen.getByTestId("gold-amount");
    expect(goldText.textContent).toMatch(/12/);
  });
});

describe("SpoilsOfWar — flavor text", () => {
  it("renders the flavor text", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    expect(
      screen.getByText("Pockets picked clean. A few coins and dust.")
    ).toBeInTheDocument();
  });

  it("renders different flavor text for rare payload", () => {
    render(<SpoilsOfWar payload={rarePayload} onClaim={vi.fn()} />);
    expect(
      screen.getByText("The air around the corpse hums with faint energy.")
    ).toBeInTheDocument();
  });
});

describe("SpoilsOfWar — item rendering", () => {
  it("renders all mundane item names", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    expect(screen.getByText("Tarnished copper bracelet")).toBeInTheDocument();
    expect(screen.getByText("Cracked leather satchel")).toBeInTheDocument();
  });

  it("renders magic item names when present", () => {
    render(<SpoilsOfWar payload={rarePayload} onClaim={vi.fn()} />);
    expect(screen.getByText("Blade of Bitter Resolve")).toBeInTheDocument();
  });

  it("does not render a magic items section when magicItems is empty", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    expect(screen.queryByTestId("magic-items-section")).not.toBeInTheDocument();
  });

  it("renders the magic items section when magicItems exist", () => {
    render(<SpoilsOfWar payload={rarePayload} onClaim={vi.fn()} />);
    expect(screen.getByTestId("magic-items-section")).toBeInTheDocument();
  });

  it("renders the legendary item name", () => {
    render(<SpoilsOfWar payload={legendaryPayload} onClaim={vi.fn()} />);
    expect(screen.getByText("The Hollow Crown")).toBeInTheDocument();
  });
});

describe("SpoilsOfWar — rarity badge", () => {
  it("shows the rarityBracket as a badge", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    const badge = screen.getByTestId("rarity-badge");
    expect(badge.textContent?.toLowerCase()).toContain("mundane");
  });

  it("shows RARE badge for rare payload", () => {
    render(<SpoilsOfWar payload={rarePayload} onClaim={vi.fn()} />);
    const badge = screen.getByTestId("rarity-badge");
    expect(badge.textContent?.toLowerCase()).toContain("rare");
  });

  it("shows LEGENDARY badge for legendary payload", () => {
    render(<SpoilsOfWar payload={legendaryPayload} onClaim={vi.fn()} />);
    const badge = screen.getByTestId("rarity-badge");
    expect(badge.textContent?.toLowerCase()).toContain("legendary");
  });
});

describe("SpoilsOfWar — interactions", () => {
  it("calls onClaim when 'Claim & Continue' button is clicked", () => {
    const onClaim = vi.fn();
    render(<SpoilsOfWar payload={mundanePayload} onClaim={onClaim} />);

    fireEvent.click(screen.getByRole("button", { name: /claim/i }));

    expect(onClaim).toHaveBeenCalledOnce();
  });

  it("calls onClaim when Escape key is pressed", () => {
    const onClaim = vi.fn();
    render(<SpoilsOfWar payload={mundanePayload} onClaim={onClaim} />);

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    expect(onClaim).toHaveBeenCalledOnce();
  });

  it("does not call onClaim for non-Escape keys", () => {
    const onClaim = vi.fn();
    render(<SpoilsOfWar payload={mundanePayload} onClaim={onClaim} />);

    fireEvent.keyDown(document, { key: "Enter", code: "Enter" });

    expect(onClaim).not.toHaveBeenCalled();
  });
});

describe("SpoilsOfWar — item descriptions", () => {
  it("renders the description of a mundane item", () => {
    render(<SpoilsOfWar payload={mundanePayload} onClaim={vi.fn()} />);
    expect(
      screen.getByText("A thin band of hammered copper, green with age.")
    ).toBeInTheDocument();
  });

  it("renders the description of a magic item", () => {
    render(<SpoilsOfWar payload={rarePayload} onClaim={vi.fn()} />);
    expect(
      screen.getByText(
        "A single-edged sword whose blade darkens when drawn in anger."
      )
    ).toBeInTheDocument();
  });
});
