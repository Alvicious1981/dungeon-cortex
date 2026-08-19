/**
 * Who a spell legally affects. The client used to decide this by sending a list
 * of combatant IDs, which the gate applied verbatim.
 */
import { describe, expect, it } from "vitest";
import { resolveAreaTargets } from "@/lib/rules/spell-targeting";
import type { GridCombatant } from "@/lib/rules/geometry";

const at = (id: string, x: number, y: number): GridCombatant =>
  ({ id, x, y, size: "Medium" });

const caster = { x: 0, y: 0 };

describe("resolveAreaTargets", () => {
  it("centres a point-anchored area on the aim point, not on the caster", () => {
    const combatants = [at("near-caster", 1, 0), at("near-aim", 10, 0)];
    const result = resolveAreaTargets({
      area: { shape: "sphere", sizeFt: 10 },
      aim: { x: 10, y: 0 },
      caster,
      combatants,
    });

    expect(result).toEqual({ ok: true, targets: [combatants[1]] });
  });

  it("anchors a directional area at the caster and aims it at the point", () => {
    // A cone does not get placed; it emanates from the caster towards the aim.
    const combatants = [at("in-path", 2, 0), at("off-path", 0, 3)];
    const result = resolveAreaTargets({
      area: { shape: "cone", sizeFt: 30 },
      aim: { x: 5, y: 0 },
      caster,
      combatants,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.targets.map((c) => c.id)).toEqual(["in-path"]);
  });

  it("refuses when there is no aim point at all", () => {
    const result = resolveAreaTargets({
      area: { shape: "sphere", sizeFt: 20 },
      aim: null,
      caster,
      combatants: [at("someone", 1, 0)],
    });

    expect(result).toMatchObject({ ok: false, code: "AIM_REQUIRED" });
  });

  it("refuses a directional area aimed at the caster's own square", () => {
    // isInCone already guards a zero vector, but an empty target list would
    // read as "the spell hit nobody" rather than "that aim is not usable".
    const result = resolveAreaTargets({
      area: { shape: "line", sizeFt: 30 },
      aim: { x: 0, y: 0 },
      caster,
      combatants: [at("someone", 2, 0)],
    });

    expect(result).toMatchObject({ ok: false, code: "DEGENERATE_DIRECTION" });
  });

  // ── The two assertions that close the hole, in both directions ────────────

  it("omits a creature outside the area even when the client named it", () => {
    const inside = at("inside", 1, 0);
    const outside = at("outside", 40, 0);
    const result = resolveAreaTargets({
      area: { shape: "sphere", sizeFt: 10 },
      aim: { x: 0, y: 0 },
      caster,
      combatants: [inside, outside],
    });

    expect(result.ok && result.targets.map((c) => c.id)).toEqual(["inside"]);
  });

  it("includes a creature inside the area that nobody named, allies included", () => {
    // This exists to stop a later "fix" that intersects the client's list with
    // the geometric set. That would let a player spare allies by not ticking
    // them — the same client-side mechanical decision this module removes.
    const ally = at("ally", 1, 0);
    const enemy = at("enemy", 1, 1);
    const result = resolveAreaTargets({
      area: { shape: "sphere", sizeFt: 20 },
      aim: { x: 1, y: 0 },
      caster,
      combatants: [ally, enemy],
    });

    expect(result.ok && result.targets.map((c) => c.id).sort()).toEqual(["ally", "enemy"]);
  });
});
