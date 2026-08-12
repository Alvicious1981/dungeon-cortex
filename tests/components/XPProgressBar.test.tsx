/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import XPProgressBar from "@/components/character/XPProgressBar";

// ---------------------------------------------------------------------------
// XPProgressBar — render
// ---------------------------------------------------------------------------

describe("XPProgressBar — render", () => {
  it("renders an Experience label", () => {
    render(<XPProgressBar xp={500} level={2} />);
    expect(screen.getByText(/Experience/i)).toBeDefined();
  });

  it("renders a meter element with correct aria attributes", () => {
    render(<XPProgressBar xp={500} level={2} />);
    const meter = screen.getByRole("meter");
    expect(meter).toBeDefined();
  });

  it("meter aria-valuenow matches current xp", () => {
    render(<XPProgressBar xp={500} level={2} />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("500");
  });

  it("meter aria-valuemin is the current level XP floor (level 2 = 300)", () => {
    render(<XPProgressBar xp={500} level={2} />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuemin")).toBe("300");
  });

  it("meter aria-valuemax is the next level threshold (level 2 → 3 = 900)", () => {
    render(<XPProgressBar xp={500} level={2} />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuemax")).toBe("900");
  });

  it("shows 'Ascended' label at max level (20)", () => {
    render(<XPProgressBar xp={355000} level={20} />);
    expect(screen.getByText(/Ascended/i)).toBeDefined();
  });

  it("does NOT show 'Ascended' for non-max levels", () => {
    render(<XPProgressBar xp={500} level={2} />);
    expect(screen.queryByText(/Ascended/i)).toBeNull();
  });

  it("displays XP value formatted with locale separators for large numbers", () => {
    // xp=14000 is exactly the level-6 threshold, so level must be 6 here —
    // at level 5 this fixture would be a pending-ascension state instead.
    render(<XPProgressBar xp={14000} level={6} />);
    // Should contain the numeric value somewhere in the output
    const container = document.body;
    expect(container.textContent).toContain("14");
  });

  it("fill bar width is 100% at max level", () => {
    const { container } = render(<XPProgressBar xp={355000} level={20} />);
    const fill = container.querySelector("[style*='width: 100%']");
    expect(fill).not.toBeNull();
  });

  it("fill bar width is 0% at the floor of a level (just reached level 2)", () => {
    // XP = 300 = exactly the level 2 floor → 0% progress toward level 3
    const { container } = render(<XPProgressBar xp={300} level={2} />);
    const fill = container.querySelector("[style*='width: 0%']");
    expect(fill).not.toBeNull();
  });

  it("aria-label describes the progress at non-max level", () => {
    render(<XPProgressBar xp={500} level={2} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toContain("level 3");
  });

  it("aria-label describes max level reached", () => {
    render(<XPProgressBar xp={355000} level={20} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("maximum");
  });
});

// ---------------------------------------------------------------------------
// XPProgressBar — fill ratio correctness
// ---------------------------------------------------------------------------

describe("XPProgressBar — fill ratio", () => {
  it("fills 50% when halfway between level 1 and level 2 (0 → 300, at 150)", () => {
    // Level 1: floor=0, ceil=300. At xp=150: (150-0)/(300-0) = 50%
    const { container } = render(<XPProgressBar xp={150} level={1} />);
    const fill = container.querySelector("[style*='width: 50%']");
    expect(fill).not.toBeNull();
  });

  it("clamps to 100% when XP exceeds next threshold", () => {
    // Level 1 at 999 XP (threshold is 300) → clamped to 100%
    const { container } = render(<XPProgressBar xp={999} level={1} />);
    const fill = container.querySelector("[style*='width: 100%']");
    expect(fill).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// XPProgressBar — Model E pending ascensions
//
// `level` is the last mechanically applied level; XP may already support
// several levels above it. The bar must never compute a percentage against
// `level + 1` in that case (it can exceed 100% and produce incoherent ARIA),
// and must never present the pending ascension as if it were already applied.
// ---------------------------------------------------------------------------

describe("XPProgressBar — pending ascensions (Model E)", () => {
  it("shows a full bar, not a >100% or negative one, when XP supports several levels above the applied one", () => {
    // xp=6500 supports level 5; level=1 is the applied level -> 4 pending.
    const { container } = render(<XPProgressBar xp={6500} level={1} />);
    const fill = container.querySelector("[style*='width: 100%']");
    expect(fill).not.toBeNull();
    expect(container.textContent).toContain("100%");
    // Never a percentage above 100 (e.g. no runaway "650%").
    expect(container.textContent).not.toMatch(/\d{4,}%/);
  });

  it("keeps aria-valuenow, aria-valuemin and aria-valuemax coherent when pending", () => {
    const { container } = render(<XPProgressBar xp={6500} level={1} />);
    const meter = screen.getByRole("meter");
    const now = Number(meter.getAttribute("aria-valuenow"));
    const min = Number(meter.getAttribute("aria-valuemin"));
    const max = Number(meter.getAttribute("aria-valuemax"));

    expect(now).toBe(6500);
    expect(min).toBeLessThanOrEqual(now);
    expect(now).toBeLessThanOrEqual(max);
    void container;
  });

  it("never shows the applied level's next threshold as if XP were still accruing toward it", () => {
    render(<XPProgressBar xp={6500} level={1} />);
    // The old, incoherent presentation: "6500 / 300 xp".
    expect(screen.queryByText(/6,500 \/ 300 xp/i)).toBeNull();
  });

  it("announces the pending ascension count instead of 'Ascended'", () => {
    render(<XPProgressBar xp={6500} level={1} />);
    expect(screen.getByText(/4 Level-Ups Pending/i)).toBeDefined();
    expect(screen.queryByText(/Ascended/i)).toBeNull();
  });

  it("aria-label mentions the pending count and the level the XP supports", () => {
    render(<XPProgressBar xp={6500} level={1} />);
    const meter = screen.getByRole("meter");
    const label = meter.getAttribute("aria-label") ?? "";
    expect(label).toContain("4 level-up(s) pending");
    expect(label).toContain("level 5");
  });

  it("uses singular phrasing for exactly one pending level-up", () => {
    // xp=300 supports level 2; level=1 applied -> exactly 1 pending.
    render(<XPProgressBar xp={300} level={1} />);
    expect(screen.getByText(/^1 Level-Up Pending$/)).toBeDefined();
  });

  it("does not enter the pending state when XP has not yet crossed the next threshold", () => {
    // xp=299 does not reach the level-2 threshold (300) -> no pending.
    render(<XPProgressBar xp={299} level={1} />);
    expect(screen.queryByText(/Pending/i)).toBeNull();
  });

  it("level 20 stays 'Ascended' rather than reporting pending ascensions", () => {
    // getLevelFromXP caps at 20, so a level-20 character can never have
    // pendingLevels > 0 — this guards against a future off-by-one regression.
    render(<XPProgressBar xp={500_000} level={20} />);
    expect(screen.getByText(/Ascended/i)).toBeDefined();
    expect(screen.queryByText(/Pending/i)).toBeNull();

    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("500000");
    expect(meter.getAttribute("aria-valuemax")).toBe("500000");
  });
});
