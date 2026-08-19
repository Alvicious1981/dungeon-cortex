/**
 * Who a spell legally affects. The client used to decide this by sending a list
 * of combatant IDs, which the gate applied verbatim.
 */
import { describe, expect, it } from "vitest";
import { checkSpellRange, resolveAreaTargets } from "@/lib/rules/spell-targeting";
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

describe("checkSpellRange", () => {
  const caster: GridCombatant = { id: "p1", x: 0, y: 0, size: "Medium" };
  const at = (id: string, x: number, y: number): GridCombatant =>
    ({ id, x, y, size: "Medium" });

  it("allows an aim point inside the spell's range", () => {
    expect(
      checkSpellRange({
        range: { kind: "distance", feetFromCaster: 60 },
        caster,
        aim: { x: 12, y: 0 },
        targets: [],
      })
    ).toEqual({ ok: true, enforced: true });
  });

  it("refuses an aim point beyond it, naming both distances", () => {
    const verdict = checkSpellRange({
      range: { kind: "distance", feetFromCaster: 30 },
      caster,
      aim: { x: 8, y: 0 },
      targets: [],
    });

    expect(verdict).toMatchObject({ ok: false, code: "OUT_OF_RANGE" });
    expect(verdict.ok === false && verdict.message).toContain("40");
    expect(verdict.ok === false && verdict.message).toContain("30");
  });

  it("measures a non-area spell against each target", () => {
    const verdict = checkSpellRange({
      range: { kind: "distance", feetFromCaster: 30 },
      caster,
      aim: null,
      targets: [at("near", 2, 0), at("far", 20, 0)],
    });

    expect(verdict).toMatchObject({ ok: false, code: "OUT_OF_RANGE" });
  });

  it("refuses the whole cast rather than dropping the out-of-range target", () => {
    // Dropping it silently would be the backend altering the player's selection
    // without telling them.
    const verdict = checkSpellRange({
      range: { kind: "distance", feetFromCaster: 30 },
      caster,
      aim: null,
      targets: [at("near", 1, 0), at("far", 20, 0)],
    });

    expect(verdict.ok).toBe(false);
  });

  it("allows a touch spell on an adjacent creature and refuses one further", () => {
    const adjacent = checkSpellRange({
      range: { kind: "touch" },
      caster,
      aim: null,
      targets: [at("t", 1, 1)],
    });
    const distant = checkSpellRange({
      range: { kind: "touch" },
      caster,
      aim: null,
      targets: [at("t", 3, 0)],
    });

    expect(adjacent).toEqual({ ok: true, enforced: true });
    expect(distant).toMatchObject({ ok: false, code: "OUT_OF_RANGE" });
    expect(distant.ok === false && distant.message.toLowerCase()).toContain("adjacent");
  });

  it("always allows a caster-only spell, ignoring any aim point", () => {
    // A self spell has no point to choose. Refusing would punish the player for
    // sending an irrelevant field.
    expect(
      checkSpellRange({
        range: { kind: "self" },
        caster,
        aim: { x: 99, y: 99 },
        targets: [],
      })
    ).toEqual({ ok: true, enforced: true });
  });

  it("allows an unenforceable range and says it went unchecked", () => {
    expect(
      checkSpellRange({
        range: { kind: "unenforceable", raw: "Ilimitado" },
        caster,
        aim: { x: 99, y: 99 },
        targets: [],
      })
    ).toEqual({ ok: true, enforced: false, raw: "Ilimitado" });
  });

  it("passes a spell that resolved to nothing to measure", () => {
    // A self-buff with neither an area nor a selection.
    expect(
      checkSpellRange({
        range: { kind: "distance", feetFromCaster: 30 },
        caster,
        aim: null,
        targets: [],
      })
    ).toEqual({ ok: true, enforced: true });
  });

  it("names the creature in the refusal message, not its database id", () => {
    const verdict = checkSpellRange({
      range: { kind: "distance", feetFromCaster: 30 },
      caster,
      aim: null,
      targets: [{ id: "cmt_01h9xabcdefg", name: "Goblin Scout", x: 20, y: 0, size: "Medium" }],
    });

    expect(verdict).toMatchObject({ ok: false, code: "OUT_OF_RANGE" });
    expect(verdict.ok === false && verdict.message).toContain("Goblin Scout");
    expect(verdict.ok === false && verdict.message).not.toContain("cmt_01h9xabcdefg");
  });

  it("falls back to the id when a target carries no name", () => {
    // Compatibility: a bare GridCombatant, with no `name`, must still produce
    // a readable message rather than an undefined one.
    const verdict = checkSpellRange({
      range: { kind: "distance", feetFromCaster: 30 },
      caster,
      aim: null,
      targets: [at("t1", 20, 0)],
    });

    expect(verdict.ok === false && verdict.message).toContain("t1");
  });

  it("uses the caster's footprint, so a big caster reaches further", () => {
    // The discriminating case: anchor to anchor is 40 ft and would refuse; the
    // Large caster's near edge is 35 ft away and legally reaches.
    const largeCaster: GridCombatant = { id: "ogre", x: 0, y: 0, size: "Large" };
    expect(
      checkSpellRange({
        range: { kind: "distance", feetFromCaster: 35 },
        caster: largeCaster,
        aim: { x: 8, y: 0 },
        targets: [],
      })
    ).toEqual({ ok: true, enforced: true });
  });
});
