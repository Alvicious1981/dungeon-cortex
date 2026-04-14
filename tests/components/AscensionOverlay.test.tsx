/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { AscensionOverlay } from "@/components/character/AscensionOverlay";
import type { LevelUpPayload } from "@/lib/rules/progression";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fighterPayload: LevelUpPayload = {
  characterId:     "char-01",
  previousLevel:   4,
  newLevel:        5,
  hitDie:          "1d10",
  hpRoll:          7,
  conModifier:     2,
  hpGained:        9,
  previousMaxHp:   36,
  newMaxHp:        45,
  newHitDiceTotal: 5,
  className:       "fighter",
};

const wizardPayload: LevelUpPayload = {
  characterId:     "char-02",
  previousLevel:   1,
  newLevel:        2,
  hitDie:          "1d6",
  hpRoll:          4,
  conModifier:     -1,
  hpGained:        3,
  previousMaxHp:   6,
  newMaxHp:        9,
  newHitDiceTotal: 2,
  className:       "wizard",
};

// ---------------------------------------------------------------------------
// AscensionOverlay — render
// ---------------------------------------------------------------------------

describe("AscensionOverlay — render", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <AscensionOverlay payload={fighterPayload} isOpen={false} onAccept={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the overlay when isOpen is true", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("displays the previous and new level numbers", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    expect(screen.getByText("4")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
  });

  it("displays the class name capitalised", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    expect(screen.getByText(/Fighter/)).toBeDefined();
  });

  it("displays the hit die string", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    // "1d10" should appear in the Hit Die stat line
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("1d10");
  });

  it("displays the hp roll", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("rolled 7");
  });

  it("displays a positive CON modifier with + prefix", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("+2");
  });

  it("displays a negative CON modifier without extra + prefix", () => {
    render(
      <AscensionOverlay payload={wizardPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("-1");
  });

  it("displays HP gained with + prefix", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("+9");
  });

  it("displays previous and new max HP", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("36");
    expect(text).toContain("45");
  });

  it("displays hit dice total", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("5");
  });

  it("stat panel has aria-live polite for screen readers", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const live = screen.getByRole("dialog").querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
  });

  it("wizard payload: shows 1d6 hit die", () => {
    render(
      <AscensionOverlay payload={wizardPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("1d6");
  });
});

// ---------------------------------------------------------------------------
// AscensionOverlay — confirmation button
// ---------------------------------------------------------------------------

describe("AscensionOverlay — confirmation button", () => {
  it("renders the 'Accept the Forge's Gift' button", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain("Accept the Forge");
  });

  it("calls onAccept when button is clicked", () => {
    const onAccept = vi.fn();
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={onAccept} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("button has descriptive aria-label including new level and hp gained", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const btn = screen.getByRole("button");
    const label = btn.getAttribute("aria-label") ?? "";
    expect(label).toContain("level 5");
    expect(label).toContain("9 hit point");
  });
});

// ---------------------------------------------------------------------------
// AscensionOverlay — keyboard accessibility
// ---------------------------------------------------------------------------

describe("AscensionOverlay — keyboard", () => {
  it("calls onAccept when Escape key is pressed", () => {
    const onAccept = vi.fn();
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={onAccept} />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("does NOT call onAccept for non-Escape keys", () => {
    const onAccept = vi.fn();
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={onAccept} />
    );
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: " " });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("dialog has aria-modal true", () => {
    render(
      <AscensionOverlay payload={fighterPayload} isOpen={true} onAccept={vi.fn()} />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});
