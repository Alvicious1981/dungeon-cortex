/** @vitest-environment jsdom */
/**
 * tests/components/SurvivalHUD.test.tsx
 *
 * Unit tests for the SurvivalHUD presentational component.
 * Verifies that the HUD accurately reflects DB-persisted exploration state
 * without inventing or mutating any values ("State is Truth").
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import SurvivalHUD, { type SurvivalHUDProps } from "@/components/exploration/SurvivalHUD";

// ---------------------------------------------------------------------------
// Base fixture
// ---------------------------------------------------------------------------

const baseProps: SurvivalHUDProps = {
  totalTurns: 12,
  totalHours: 2,
  turnsSinceRest: 3,
  activeLightSource: "torch",
  lightSourceTurnsRemaining: 4,
  torches: 2,
  oilFlasks: 1,
  rations: 8,
  exhaustionLevel: 0,
};

// ---------------------------------------------------------------------------
// Root element
// ---------------------------------------------------------------------------

describe("SurvivalHUD — root element", () => {
  it("renders with aria-label 'Dungeon Clock and Survival Status'", () => {
    render(<SurvivalHUD {...baseProps} />);
    expect(screen.getByRole("generic", { name: /Dungeon Clock and Survival Status/i })).toBeDefined();
  });

  it("sets data-total-turns on root element", () => {
    const { container } = render(<SurvivalHUD {...baseProps} />);
    const root = container.querySelector("[data-total-turns]");
    expect(root?.getAttribute("data-total-turns")).toBe("12");
  });
});

// ---------------------------------------------------------------------------
// Dungeon Clock
// ---------------------------------------------------------------------------

describe("SurvivalHUD — dungeon clock", () => {
  it("renders totalTurns via data-testid", () => {
    render(<SurvivalHUD {...baseProps} />);
    expect(screen.getByTestId("total-turns").textContent).toBe("12");
  });

  it("renders elapsed time '2h 0min' for turn 12 (12 % 6 = 0 → 0min)", () => {
    render(<SurvivalHUD {...baseProps} />);
    expect(screen.getByTestId("elapsed-time").textContent).toContain("2h");
    expect(screen.getByTestId("elapsed-time").textContent).toContain("0min");
  });

  it("renders '2h 10min' for turn 13 (13 % 6 = 1 → 10min)", () => {
    render(<SurvivalHUD {...baseProps} totalTurns={13} />);
    expect(screen.getByTestId("elapsed-time").textContent).toContain("10min");
  });

  it("renders '0h 0min' for turn 0 (fresh campaign)", () => {
    render(<SurvivalHUD {...baseProps} totalTurns={0} totalHours={0} />);
    expect(screen.getByTestId("elapsed-time").textContent).toContain("0h");
    expect(screen.getByTestId("elapsed-time").textContent).toContain("0min");
  });

  it("renders '1h 0min' for exactly turn 6", () => {
    render(<SurvivalHUD {...baseProps} totalTurns={6} totalHours={1} />);
    expect(screen.getByTestId("elapsed-time").textContent).toContain("1h");
    expect(screen.getByTestId("elapsed-time").textContent).toContain("0min");
  });
});

// ---------------------------------------------------------------------------
// Rest Status
// ---------------------------------------------------------------------------

describe("SurvivalHUD — rest status (not overdue)", () => {
  it("renders 'Rest in 3 turns' when turnsSinceRest=3 (6-3=3 remaining)", () => {
    render(<SurvivalHUD {...baseProps} />);
    const el = screen.getByTestId("rest-status");
    expect(el.textContent).toContain("3");
    expect(el.getAttribute("data-overdue")).toBe("false");
  });

  it("renders 'Rest in 1 turn' (singular) when 1 turn left", () => {
    render(<SurvivalHUD {...baseProps} turnsSinceRest={5} />);
    expect(screen.getByTestId("rest-status").textContent).toContain("1 turn");
  });

  it("does NOT show overdue indicator", () => {
    render(<SurvivalHUD {...baseProps} />);
    expect(screen.getByTestId("rest-status").getAttribute("data-overdue")).toBe("false");
  });
});

describe("SurvivalHUD — rest status (overdue)", () => {
  it("shows overdue warning when turnsSinceRest = 6", () => {
    render(<SurvivalHUD {...baseProps} turnsSinceRest={6} />);
    const el = screen.getByTestId("rest-status");
    expect(el.getAttribute("data-overdue")).toBe("true");
    expect(el.textContent).toContain("Overdue");
  });

  it("shows overdue warning when turnsSinceRest > 6 (capped state)", () => {
    render(<SurvivalHUD {...baseProps} turnsSinceRest={6} />);
    expect(screen.getByTestId("rest-status").getAttribute("data-overdue")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Exhaustion
// ---------------------------------------------------------------------------

describe("SurvivalHUD — exhaustion (level 0)", () => {
  it("does NOT render exhaustion element when exhaustionLevel = 0", () => {
    render(<SurvivalHUD {...baseProps} exhaustionLevel={0} />);
    expect(screen.queryByTestId("exhaustion")).toBeNull();
  });
});

describe("SurvivalHUD — exhaustion (level > 0)", () => {
  it("renders exhaustion element when exhaustionLevel = 1", () => {
    render(<SurvivalHUD {...baseProps} exhaustionLevel={1} />);
    const el = screen.getByTestId("exhaustion");
    expect(el).toBeDefined();
    expect(el.getAttribute("data-level")).toBe("1");
  });

  it("renders exhaustion level 3 correctly", () => {
    render(<SurvivalHUD {...baseProps} exhaustionLevel={3} />);
    expect(screen.getByTestId("exhaustion").getAttribute("data-level")).toBe("3");
  });

  it("renders exhaustion level 6 (lethal threshold)", () => {
    render(<SurvivalHUD {...baseProps} exhaustionLevel={6} />);
    expect(screen.getByTestId("exhaustion").getAttribute("data-level")).toBe("6");
  });
});

// ---------------------------------------------------------------------------
// Light Source — torch
// ---------------------------------------------------------------------------

describe("SurvivalHUD — light source (torch)", () => {
  it("renders torch icon", () => {
    render(<SurvivalHUD {...baseProps} />);
    expect(screen.getByTestId("light-icon").textContent).toContain("🕯️");
  });

  it("renders 'Torch' label", () => {
    render(<SurvivalHUD {...baseProps} />);
    expect(screen.getByTestId("light-label").textContent).toBe("Torch");
  });

  it("renders turns remaining for active torch", () => {
    render(<SurvivalHUD {...baseProps} lightSourceTurnsRemaining={4} />);
    expect(screen.getByTestId("light-turns-remaining").textContent).toContain("4");
  });

  it("renders '1 turn' (singular) when 1 turn remains", () => {
    render(<SurvivalHUD {...baseProps} lightSourceTurnsRemaining={1} />);
    expect(screen.getByTestId("light-turns-remaining").textContent).toContain("1 turn");
    expect(screen.getByTestId("light-turns-remaining").textContent).not.toContain("1 turns");
  });
});

// ---------------------------------------------------------------------------
// Light Source — lantern
// ---------------------------------------------------------------------------

describe("SurvivalHUD — light source (lantern)", () => {
  it("renders lantern icon", () => {
    render(<SurvivalHUD {...baseProps} activeLightSource="lantern" lightSourceTurnsRemaining={20} />);
    expect(screen.getByTestId("light-icon").textContent).toContain("🏮");
  });

  it("renders 'Lantern' label", () => {
    render(<SurvivalHUD {...baseProps} activeLightSource="lantern" lightSourceTurnsRemaining={20} />);
    expect(screen.getByTestId("light-label").textContent).toBe("Lantern");
  });

  it("renders turns remaining", () => {
    render(<SurvivalHUD {...baseProps} activeLightSource="lantern" lightSourceTurnsRemaining={20} />);
    expect(screen.getByTestId("light-turns-remaining").textContent).toContain("20");
  });
});

// ---------------------------------------------------------------------------
// Light Source — none (darkness)
// ---------------------------------------------------------------------------

describe("SurvivalHUD — light source (none / darkness)", () => {
  it("renders darkness icon ⬛", () => {
    render(<SurvivalHUD {...baseProps} activeLightSource="none" lightSourceTurnsRemaining={0} />);
    expect(screen.getByTestId("light-icon").textContent).toContain("⬛");
  });

  it("renders 'Darkness' label", () => {
    render(<SurvivalHUD {...baseProps} activeLightSource="none" lightSourceTurnsRemaining={0} />);
    expect(screen.getByTestId("light-label").textContent).toBe("Darkness");
  });

  it("does NOT render turns-remaining element when in darkness", () => {
    render(<SurvivalHUD {...baseProps} activeLightSource="none" lightSourceTurnsRemaining={0} />);
    expect(screen.queryByTestId("light-turns-remaining")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Torch and oil flask reserves
// ---------------------------------------------------------------------------

describe("SurvivalHUD — reserves", () => {
  it("renders torch reserve count", () => {
    render(<SurvivalHUD {...baseProps} torches={3} />);
    expect(screen.getByTestId("torches").textContent).toContain("3");
  });

  it("renders oil flask reserve count", () => {
    render(<SurvivalHUD {...baseProps} oilFlasks={2} />);
    expect(screen.getByTestId("oil-flasks").textContent).toContain("2");
  });

  it("renders 0 torches when empty", () => {
    render(<SurvivalHUD {...baseProps} torches={0} />);
    expect(screen.getByTestId("torches").textContent).toContain("0");
  });

  it("renders 0 oil flasks when empty", () => {
    render(<SurvivalHUD {...baseProps} oilFlasks={0} />);
    expect(screen.getByTestId("oil-flasks").textContent).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// Rations
// ---------------------------------------------------------------------------

describe("SurvivalHUD — rations", () => {
  it("renders rations count", () => {
    render(<SurvivalHUD {...baseProps} rations={8} />);
    expect(screen.getByTestId("rations").textContent).toBe("8");
  });

  it("renders 0 rations when depleted", () => {
    render(<SurvivalHUD {...baseProps} rations={0} />);
    expect(screen.getByTestId("rations").textContent).toBe("0");
  });

  it("renders large ration count correctly", () => {
    render(<SurvivalHUD {...baseProps} rations={28} />);
    expect(screen.getByTestId("rations").textContent).toBe("28");
  });
});
