import { describe, expect, it } from "vitest";
import { hpColor, hpRatio } from "@/components/combat/hit-points";

describe("combat hit-point presentation helpers", () => {
  it.each([
    { hp: 0, maxHp: 20, color: "#EF4444" },
    { hp: 5, maxHp: 20, color: "#EF4444" },
    { hp: 10, maxHp: 20, color: "#F59E0B" },
    { hp: 11, maxHp: 20, color: "#4ADE80" },
    { hp: 0, maxHp: 0, color: "#4ADE80" },
  ])("maps $hp/$maxHp to $color", ({ hp, maxHp, color }) => {
    expect(hpColor(hp, maxHp)).toBe(color);
  });

  it.each([
    { hp: -1, maxHp: 20, ratio: 0 },
    { hp: 5, maxHp: 20, ratio: 0.25 },
    { hp: 25, maxHp: 20, ratio: 1 },
    { hp: 5, maxHp: 0, ratio: 0 },
  ])("clamps $hp/$maxHp to $ratio", ({ hp, maxHp, ratio }) => {
    expect(hpRatio(hp, maxHp)).toBe(ratio);
  });
});
