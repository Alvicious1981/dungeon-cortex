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

/** One representative of every kind in the union. */
const ALL_KINDS: SpellRange[] = [
  { kind: "distance", feetFromCaster: 30 },
  { kind: "touch" },
  { kind: "self" },
  { kind: "unenforceable", raw: "Ilimitado" },
];

describe("cobertura de los tipos de alcance", () => {
  it.each(ALL_KINDS)("$kind produce un veredicto utilizable", (range) => {
    const verdict = checkSpellRange({
      range,
      caster,
      aim: { x: 1, y: 0 },
      targets: [],
    });

    // Every kind must answer. A kind falling through to undefined, or returning
    // a shape the gate cannot read, fails here.
    expect(verdict).toBeDefined();
    expect(typeof verdict.ok).toBe("boolean");
    if (verdict.ok) expect(typeof verdict.enforced).toBe("boolean");
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
