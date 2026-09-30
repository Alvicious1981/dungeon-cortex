/** @vitest-environment jsdom */
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ExhaustionIndicator, {
  exhaustionEffectLabels,
  exhaustionWarning,
} from "@/components/character/ExhaustionIndicator";

afterEach(cleanup);

describe("ExhaustionIndicator — render", () => {
  it("renders nothing at level 0", () => {
    const { container } = render(<ExhaustionIndicator exhaustionLevel={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a missing level", () => {
    const { container } = render(<ExhaustionIndicator exhaustionLevel={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the level out of six and names itself for screen readers", () => {
    render(<ExhaustionIndicator exhaustionLevel={2} />);
    const status = screen.getByRole("status", { name: "Agotamiento nivel 2 de 6" });
    expect(status.textContent).toContain("2 / 6");
    expect(status.textContent).toContain("Velocidad a la mitad");
    expect(status.textContent).toContain("Cada descanso largo reduce un nivel.");
  });

  it("warns from level 4", () => {
    render(<ExhaustionIndicator exhaustionLevel={4} />);
    expect(screen.getByTestId("exhaustion-indicator").textContent).toContain(
      "con dos niveles más mueres"
    );
  });
});

describe("exhaustionEffectLabels — one phrase per effect the rule applies", () => {
  it("level 1: ability checks only", () => {
    expect(exhaustionEffectLabels(1)).toEqual(["Desventaja en pruebas de característica"]);
  });

  it("level 3: adds halved speed, then attacks and saves", () => {
    expect(exhaustionEffectLabels(3)).toEqual([
      "Desventaja en pruebas de característica",
      "Velocidad a la mitad",
      "Desventaja en ataques y tiradas de salvación",
    ]);
  });

  it("level 5: speed 0 replaces halved speed, and the maximum is halved", () => {
    expect(exhaustionEffectLabels(5)).toEqual([
      "Desventaja en pruebas de característica",
      "Velocidad 0: no puedes moverte ni viajar",
      "Desventaja en ataques y tiradas de salvación",
      "Puntos de golpe máximos a la mitad",
    ]);
  });

  it("level 6: death", () => {
    expect(exhaustionEffectLabels(6)).toEqual(["Muerte por agotamiento"]);
  });
});

describe("exhaustionWarning", () => {
  it("stays quiet below level 4 and at death", () => {
    expect(exhaustionWarning(3)).toBeNull();
    expect(exhaustionWarning(6)).toBeNull();
  });

  it("explains the way out at level 5", () => {
    expect(exhaustionWarning(5)).toContain("descanso largo");
  });
});
