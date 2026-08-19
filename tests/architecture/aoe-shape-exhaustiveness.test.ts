/**
 * Every area shape must resolve through a real predicate.
 *
 * The failure this prevents: a shape added to AreaShape whose case is never
 * wired into getAoETargets. TypeScript's exhaustiveness check catches a missing
 * `case` at compile time, but not a case that returns a placeholder, and not a
 * shape that silently resolves to nobody. Both would look like "the spell hit
 * no one" in play.
 */
import { describe, expect, it } from "vitest";
import { getAoETargets, type AreaShape } from "@/lib/rules/geometry";

const ALL_SHAPES: AreaShape[] = ["sphere", "cube", "cone", "line"];

describe("cobertura de formas de área", () => {
  it.each(ALL_SHAPES)("%s alcanza a una criatura colocada dentro", (shape) => {
    // One combatant one square east of the origin, and an area large enough
    // that every shape reaches it. A shape with no working predicate returns
    // an empty list and fails here.
    const hit = getAoETargets({
      shape,
      origin: { x: 0, y: 0 },
      sizeFt: 30,
      direction: { x: 1, y: 0 },
      combatants: [{ id: "target", x: 1, y: 0, size: "Medium" }],
    });

    expect(hit.map((c) => c.id)).toEqual(["target"]);
  });
});
