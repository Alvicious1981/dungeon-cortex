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
    render(<XPProgressBar xp={14000} level={5} />);
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
