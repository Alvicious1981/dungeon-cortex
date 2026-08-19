/**
 * Every SpellRange kind must reach a real rule.
 *
 * The failure this prevents: a kind added to the union whose case in
 * checkSpellRange is never wired, or wired to a placeholder. TypeScript catches
 * a missing branch at compile time, but not one that returns the wrong verdict —
 * and a range that silently always passes looks identical to a range that was
 * checked and held.
 */
import { describe, expect, it } from "vitest";
import { checkSpellRange } from "@/lib/rules/spell-targeting";
import type { GridCombatant, SpellRange } from "@/lib/rules/geometry";

const caster: GridCombatant = { id: "p1", x: 0, y: 0, size: "Medium" };

/**
 * One representative of every kind in the union, keyed by the discriminant.
 *
 * A hand-written array (the previous shape of this fixture) still type-checks
 * when a fifth kind is added to `SpellRange` — the array just stays four
 * entries long, and the new kind is never exercised, which is exactly the
 * failure this file exists to prevent. Keying by `SpellRange["kind"]` makes
 * the object's own type require every kind as a property: omitting one is a
 * compile error, not a silent gap.
 */
const ALL_KINDS: Record<SpellRange["kind"], SpellRange> = {
  distance: { kind: "distance", feetFromCaster: 30 },
  touch: { kind: "touch" },
  self: { kind: "self" },
  unenforceable: { kind: "unenforceable", raw: "Ilimitado" },
};

describe("cobertura de los tipos de alcance", () => {
  it.each(Object.values(ALL_KINDS))("$kind produce un veredicto correcto para un objetivo cercano", (range) => {
    // The aim point is 5 ft away — within every enforceable kind's minimum
    // range here, and irrelevant to self/unenforceable. A kind wired to a
    // placeholder that always refuses, not only one that falls through to
    // undefined, must fail this assertion.
    const verdict = checkSpellRange({
      range,
      caster,
      aim: { x: 1, y: 0 },
      targets: [],
    });

    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.enforced).toBe(range.kind !== "unenforceable");
    }
  });

  it("los dos tipos comprobables rechazan algo fuera de alcance", () => {
    // Guards against a kind that always passes. distance and touch must both be
    // capable of refusing; self and unenforceable are expected never to.
    for (const range of [
      { kind: "distance", feetFromCaster: 5 } as const,
      { kind: "touch" } as const,
    ]) {
      const verdict = checkSpellRange({
        range,
        caster,
        aim: { x: 20, y: 0 },
        targets: [],
      });
      expect(verdict.ok).toBe(false);
    }
  });
});
