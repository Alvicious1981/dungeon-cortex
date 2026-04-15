/** @vitest-environment jsdom */
/**
 * tests/components/DispositionBadge.test.tsx
 *
 * Unit tests for the DispositionBadge presentational component.
 * Verifies that the badge accurately reflects the NPC's persisted disposition
 * without inventing or mutating any state ("State is Truth").
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import DispositionBadge from "@/components/npc/DispositionBadge";

// ---------------------------------------------------------------------------
// Null disposition (not yet met)
// ---------------------------------------------------------------------------

describe("DispositionBadge — null disposition", () => {
  it("renders 'Unknown' text when disposition is null", () => {
    render(<DispositionBadge disposition={null} />);
    expect(screen.getByText(/Unknown/i)).toBeDefined();
  });

  it("has an aria-label mentioning 'unknown'", () => {
    render(<DispositionBadge disposition={null} />);
    const el = document.querySelector("[aria-label]");
    expect(el?.getAttribute("aria-label")?.toLowerCase()).toContain("unknown");
  });

  it("renders the ⬜ icon for unknown disposition", () => {
    const { container } = render(<DispositionBadge disposition={null} />);
    expect(container.textContent).toContain("⬜");
  });

  it("sets data-band to 'unknown'", () => {
    render(<DispositionBadge disposition={null} />);
    const el = document.querySelector("[data-band]");
    expect(el?.getAttribute("data-band")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Hostile — disposition ≤ −7
// ---------------------------------------------------------------------------

describe("DispositionBadge — Hostile", () => {
  it("renders 🔴 icon for disposition −10", () => {
    const { container } = render(<DispositionBadge disposition={-10} />);
    expect(container.textContent).toContain("🔴");
  });

  it("renders 'Hostile' band label", () => {
    render(<DispositionBadge disposition={-8} />);
    expect(screen.getByText(/Hostile/)).toBeDefined();
  });

  it("renders the numeric value by default", () => {
    const { container } = render(<DispositionBadge disposition={-8} />);
    expect(container.textContent).toContain("(-8)");
  });

  it("sets data-band to 'Hostile'", () => {
    render(<DispositionBadge disposition={-7} />);
    const el = document.querySelector("[data-band]");
    expect(el?.getAttribute("data-band")).toBe("Hostile");
  });
});

// ---------------------------------------------------------------------------
// Unfriendly — −6 to −2
// ---------------------------------------------------------------------------

describe("DispositionBadge — Unfriendly", () => {
  it("renders 🟠 icon for disposition −3", () => {
    const { container } = render(<DispositionBadge disposition={-3} />);
    expect(container.textContent).toContain("🟠");
  });

  it("renders 'Unfriendly' band label", () => {
    render(<DispositionBadge disposition={-3} />);
    expect(screen.getByText(/Unfriendly/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Indifferent — −1 to +2
// ---------------------------------------------------------------------------

describe("DispositionBadge — Indifferent", () => {
  it("renders ⚪ icon for disposition 0", () => {
    const { container } = render(<DispositionBadge disposition={0} />);
    expect(container.textContent).toContain("⚪");
  });

  it("renders 'Indifferent' band label", () => {
    render(<DispositionBadge disposition={0} />);
    expect(screen.getByText(/Indifferent/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Friendly — +3 to +7
// ---------------------------------------------------------------------------

describe("DispositionBadge — Friendly", () => {
  it("renders 🟢 icon for disposition 5", () => {
    const { container } = render(<DispositionBadge disposition={5} />);
    expect(container.textContent).toContain("🟢");
  });

  it("renders 'Friendly' band label", () => {
    render(<DispositionBadge disposition={5} />);
    expect(screen.getByText(/Friendly/)).toBeDefined();
  });

  it("aria-label includes band and value", () => {
    render(<DispositionBadge disposition={5} />);
    const el = document.querySelector("[aria-label]");
    expect(el?.getAttribute("aria-label")).toContain("Friendly");
    expect(el?.getAttribute("aria-label")).toContain("5");
  });
});

// ---------------------------------------------------------------------------
// Helpful — +8 to +10
// ---------------------------------------------------------------------------

describe("DispositionBadge — Helpful", () => {
  it("renders 💛 icon for disposition 10", () => {
    const { container } = render(<DispositionBadge disposition={10} />);
    expect(container.textContent).toContain("💛");
  });

  it("renders 'Helpful' band label", () => {
    render(<DispositionBadge disposition={10} />);
    expect(screen.getByText(/Helpful/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// data-disposition attribute (read-only state reflection)
// ---------------------------------------------------------------------------

describe("DispositionBadge — data attributes", () => {
  it("sets data-disposition to the raw disposition integer", () => {
    render(<DispositionBadge disposition={4} />);
    const el = document.querySelector("[data-disposition]");
    expect(el?.getAttribute("data-disposition")).toBe("4");
  });

  it("data-band matches the resolved band for the given value", () => {
    render(<DispositionBadge disposition={4} />);
    const el = document.querySelector("[data-band]");
    expect(el?.getAttribute("data-band")).toBe("Friendly");
  });
});

// ---------------------------------------------------------------------------
// compact mode
// ---------------------------------------------------------------------------

describe("DispositionBadge — compact prop", () => {
  it("omits the numeric value in compact mode", () => {
    const { container } = render(<DispositionBadge disposition={5} compact />);
    expect(container.textContent).not.toContain("(5)");
  });

  it("still renders the icon and band in compact mode", () => {
    const { container } = render(<DispositionBadge disposition={5} compact />);
    expect(container.textContent).toContain("🟢");
    expect(container.textContent).toContain("Friendly");
  });
});

// ---------------------------------------------------------------------------
// className passthrough
// ---------------------------------------------------------------------------

describe("DispositionBadge — className", () => {
  it("applies a custom className to the root element", () => {
    const { container } = render(
      <DispositionBadge disposition={0} className="custom-badge" />
    );
    const el = container.querySelector(".custom-badge");
    expect(el).not.toBeNull();
  });
});
