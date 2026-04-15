/** @vitest-environment jsdom */
/**
 * tests/components/WildernessHUD.test.tsx
 *
 * Unit tests for the WildernessHUD presentational component.
 * Verifies that the HUD accurately reflects DB-persisted travel state
 * without inventing or mutating any values ("State is Truth").
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import WildernessHUD, { type WildernessHUDProps } from "@/components/exploration/WildernessHUD";

// ---------------------------------------------------------------------------
// Base fixture
// ---------------------------------------------------------------------------

const baseProps: WildernessHUDProps = {
  currentQ: 3,
  currentR: -2,
  terrain: "forest",
  biome: "temperate broadleaf forest",
  watchIndex: 1,
  totalDays: 4,
  weatherCondition: "rain",
  weatherIntensity: 1,
  partyPace: "normal",
  rations: 7,
  featureHere: false,
};

// ---------------------------------------------------------------------------
// Root element
// ---------------------------------------------------------------------------

describe("WildernessHUD — root element", () => {
  it("renders with aria-label 'Wilderness and Travel Status'", () => {
    render(<WildernessHUD {...baseProps} />);
    expect(screen.getByRole("generic", { name: "Wilderness and Travel Status" })).toBeTruthy();
  });

  it("sets data-watch-index attribute on root element", () => {
    const { container } = render(<WildernessHUD {...baseProps} watchIndex={3} />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("data-watch-index")).toBe("3");
  });

  it("root data-watch-index updates for each watch slot", () => {
    for (let i = 0; i < 6; i++) {
      const { container } = render(<WildernessHUD {...baseProps} watchIndex={i} />);
      const root = container.firstChild as HTMLElement;
      expect(root.getAttribute("data-watch-index")).toBe(String(i));
    }
  });
});

// ---------------------------------------------------------------------------
// Hex position
// ---------------------------------------------------------------------------

describe("WildernessHUD — hex position", () => {
  it("renders hex position with data-testid='hex-position'", () => {
    render(<WildernessHUD {...baseProps} />);
    expect(screen.getByTestId("hex-position")).toBeTruthy();
  });

  it("shows correct positive coordinates", () => {
    render(<WildernessHUD {...baseProps} currentQ={5} currentR={3} />);
    expect(screen.getByTestId("hex-position").textContent).toContain("5");
    expect(screen.getByTestId("hex-position").textContent).toContain("3");
  });

  it("shows correct negative coordinates", () => {
    render(<WildernessHUD {...baseProps} currentQ={-1} currentR={-4} />);
    expect(screen.getByTestId("hex-position").textContent).toContain("-1");
    expect(screen.getByTestId("hex-position").textContent).toContain("-4");
  });

  it("shows origin coordinates (0, 0)", () => {
    render(<WildernessHUD {...baseProps} currentQ={0} currentR={0} />);
    expect(screen.getByTestId("hex-position").textContent).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

describe("WildernessHUD — terrain", () => {
  it("renders terrain with data-testid='terrain'", () => {
    render(<WildernessHUD {...baseProps} />);
    expect(screen.getByTestId("terrain").textContent).toBe("forest");
  });

  it("renders mountain terrain correctly", () => {
    render(<WildernessHUD {...baseProps} terrain="mountain" />);
    expect(screen.getByTestId("terrain").textContent).toBe("mountain");
  });

  it("renders desert terrain correctly", () => {
    render(<WildernessHUD {...baseProps} terrain="desert" />);
    expect(screen.getByTestId("terrain").textContent).toBe("desert");
  });

  it("renders plains terrain correctly", () => {
    render(<WildernessHUD {...baseProps} terrain="plains" />);
    expect(screen.getByTestId("terrain").textContent).toBe("plains");
  });
});

// ---------------------------------------------------------------------------
// Watch name
// ---------------------------------------------------------------------------

describe("WildernessHUD — watch name", () => {
  it("renders watch name with data-testid='watch-name'", () => {
    render(<WildernessHUD {...baseProps} watchIndex={0} />);
    expect(screen.getByTestId("watch-name").textContent).toBe("Dawn");
  });

  it("watch 0 → Dawn", () => {
    render(<WildernessHUD {...baseProps} watchIndex={0} />);
    expect(screen.getByTestId("watch-name").textContent).toBe("Dawn");
  });

  it("watch 1 → Morning", () => {
    render(<WildernessHUD {...baseProps} watchIndex={1} />);
    expect(screen.getByTestId("watch-name").textContent).toBe("Morning");
  });

  it("watch 2 → Midday", () => {
    render(<WildernessHUD {...baseProps} watchIndex={2} />);
    expect(screen.getByTestId("watch-name").textContent).toBe("Midday");
  });

  it("watch 3 → Afternoon", () => {
    render(<WildernessHUD {...baseProps} watchIndex={3} />);
    expect(screen.getByTestId("watch-name").textContent).toBe("Afternoon");
  });

  it("watch 4 → Evening", () => {
    render(<WildernessHUD {...baseProps} watchIndex={4} />);
    expect(screen.getByTestId("watch-name").textContent).toBe("Evening");
  });

  it("watch 5 → Night", () => {
    render(<WildernessHUD {...baseProps} watchIndex={5} />);
    expect(screen.getByTestId("watch-name").textContent).toBe("Night");
  });
});

// ---------------------------------------------------------------------------
// Watch index display
// ---------------------------------------------------------------------------

describe("WildernessHUD — watch index", () => {
  it("renders watch index with data-testid='watch-index'", () => {
    render(<WildernessHUD {...baseProps} watchIndex={1} />);
    expect(screen.getByTestId("watch-index")).toBeTruthy();
  });

  it("displays 1-based watch number (watchIndex 0 → '1/6')", () => {
    render(<WildernessHUD {...baseProps} watchIndex={0} />);
    expect(screen.getByTestId("watch-index").textContent).toBe("1/6");
  });

  it("displays 1-based watch number (watchIndex 5 → '6/6')", () => {
    render(<WildernessHUD {...baseProps} watchIndex={5} />);
    expect(screen.getByTestId("watch-index").textContent).toBe("6/6");
  });
});

// ---------------------------------------------------------------------------
// Total days
// ---------------------------------------------------------------------------

describe("WildernessHUD — total days", () => {
  it("renders total days with data-testid='total-days'", () => {
    render(<WildernessHUD {...baseProps} totalDays={4} />);
    expect(screen.getByTestId("total-days").textContent).toContain("4");
  });

  it("shows Day label", () => {
    render(<WildernessHUD {...baseProps} totalDays={10} />);
    expect(screen.getByTestId("total-days").textContent).toContain("Day");
    expect(screen.getByTestId("total-days").textContent).toContain("10");
  });

  it("shows Day 1 on first day", () => {
    render(<WildernessHUD {...baseProps} totalDays={1} />);
    expect(screen.getByTestId("total-days").textContent).toContain("Day 1");
  });
});

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

describe("WildernessHUD — weather", () => {
  it("renders weather condition with data-testid='weather'", () => {
    render(<WildernessHUD {...baseProps} />);
    expect(screen.getByTestId("weather").textContent).toBe("rain");
  });

  it("renders clear weather correctly", () => {
    render(<WildernessHUD {...baseProps} weatherCondition="clear" weatherIntensity={0} />);
    expect(screen.getByTestId("weather").textContent).toBe("clear");
  });

  it("renders storm weather correctly", () => {
    render(<WildernessHUD {...baseProps} weatherCondition="storm" weatherIntensity={2} />);
    expect(screen.getByTestId("weather").textContent).toBe("storm");
  });

  it("renders weather intensity with data-testid='weather-intensity'", () => {
    render(<WildernessHUD {...baseProps} weatherIntensity={1} />);
    expect(screen.getByTestId("weather-intensity")).toBeTruthy();
  });

  it("shows intensity text when weatherIntensity > 0", () => {
    render(<WildernessHUD {...baseProps} weatherIntensity={2} />);
    expect(screen.getByTestId("weather-intensity").textContent).toContain("Intensity 2");
  });

  it("shows empty intensity text when weatherIntensity is 0", () => {
    render(<WildernessHUD {...baseProps} weatherIntensity={0} />);
    expect(screen.getByTestId("weather-intensity").textContent).toBe("");
  });

  it("sets data-intensity attribute on weather-intensity element", () => {
    render(<WildernessHUD {...baseProps} weatherIntensity={1} />);
    expect(screen.getByTestId("weather-intensity").getAttribute("data-intensity")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Party pace
// ---------------------------------------------------------------------------

describe("WildernessHUD — party pace", () => {
  it("renders pace with data-testid='party-pace'", () => {
    render(<WildernessHUD {...baseProps} partyPace="normal" />);
    expect(screen.getByTestId("party-pace").textContent).toBe("normal");
  });

  it("renders fast pace", () => {
    render(<WildernessHUD {...baseProps} partyPace="fast" />);
    expect(screen.getByTestId("party-pace").textContent).toBe("fast");
  });

  it("renders slow pace", () => {
    render(<WildernessHUD {...baseProps} partyPace="slow" />);
    expect(screen.getByTestId("party-pace").textContent).toBe("slow");
  });
});

// ---------------------------------------------------------------------------
// Rations
// ---------------------------------------------------------------------------

describe("WildernessHUD — rations", () => {
  it("renders rations with data-testid='rations'", () => {
    render(<WildernessHUD {...baseProps} rations={7} />);
    expect(screen.getByTestId("rations").textContent).toBe("7");
  });

  it("shows zero rations", () => {
    render(<WildernessHUD {...baseProps} rations={0} />);
    expect(screen.getByTestId("rations").textContent).toBe("0");
  });

  it("shows large ration count", () => {
    render(<WildernessHUD {...baseProps} rations={20} />);
    expect(screen.getByTestId("rations").textContent).toBe("20");
  });
});

// ---------------------------------------------------------------------------
// Feature indicator (conditional)
// ---------------------------------------------------------------------------

describe("WildernessHUD — feature indicator", () => {
  it("does not render feature element when featureHere is false", () => {
    render(<WildernessHUD {...baseProps} featureHere={false} />);
    expect(screen.queryByTestId("feature")).toBeNull();
  });

  it("renders feature element with data-testid='feature' when featureHere is true", () => {
    render(<WildernessHUD {...baseProps} featureHere={true} />);
    expect(screen.getByTestId("feature")).toBeTruthy();
  });

  it("feature element contains descriptive text when present", () => {
    render(<WildernessHUD {...baseProps} featureHere={true} />);
    expect(screen.getByTestId("feature").textContent).toContain("feature");
  });
});
