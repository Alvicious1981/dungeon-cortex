/**
 * lib/rules/spell-targeting.ts
 *
 * Which creatures a spell legally affects.
 *
 * The action route used to answer this by applying the spell to whatever
 * combatant IDs the request carried. That let the caller decide a mechanical
 * outcome — the project's non-negotiable rule violated from the client side
 * rather than the narrator's.
 *
 * This module composes; it does not calculate. Choosing the predicate and the
 * origin lives here, the grid mathematics lives in lib/rules/geometry.ts. If a
 * cosine appears in this file, the boundary has slipped.
 *
 * @pure — no database, no I/O, no randomness.
 */

import {
  getAoETargets,
  minFootprintDistanceFt,
  TOUCH_REACH_FT,
  type GridCombatant,
  type GridPoint,
  type SpellArea,
  type SpellRange,
} from "./geometry";

export type SpellTargetingRefusal = "AIM_REQUIRED" | "DEGENERATE_DIRECTION";

export type SpellTargetingResult =
  | { ok: true; targets: GridCombatant[] }
  | { ok: false; code: SpellTargetingRefusal; message: string };

export interface AreaTargetingInput {
  area: SpellArea;
  /** The point the caster chose, when one was supplied or derivable. */
  aim: GridPoint | null;
  /** The caster's own square. Directional areas emanate from here. */
  caster: GridPoint;
  combatants: readonly GridCombatant[];
}

/** Shapes that emanate from the caster rather than being placed on a point. */
const DIRECTIONAL_SHAPES = new Set<SpellArea["shape"]>(["cone", "line"]);

/**
 * Resolves the creatures an area spell affects.
 *
 * Point-anchored shapes (sphere, cube) centre on the aim point. Directional
 * shapes (cone, line) originate at the caster and use the aim point only for
 * facing, which is how the SRD describes them: "a line 100 feet long that
 * originates from you".
 *
 * The returned set is everyone the geometry catches — the caster, their allies
 * and creatures already at 0 hp included. Excluding the party would be the same
 * silent mechanical decision this module exists to take away from the client,
 * only made by the backend instead.
 */
export function resolveAreaTargets(input: AreaTargetingInput): SpellTargetingResult {
  const { area, aim, caster, combatants } = input;

  if (!aim) {
    return {
      ok: false,
      code: "AIM_REQUIRED",
      message: "This spell needs a point to aim at. Name one creature or pick a square.",
    };
  }

  if (!DIRECTIONAL_SHAPES.has(area.shape)) {
    return {
      ok: true,
      targets: getAoETargets({
        shape: area.shape,
        origin: aim,
        sizeFt: area.sizeFt,
        combatants,
      }),
    };
  }

  const direction = { x: aim.x - caster.x, y: aim.y - caster.y };
  if (direction.x === 0 && direction.y === 0) {
    return {
      ok: false,
      code: "DEGENERATE_DIRECTION",
      message: "A cone or line needs a direction. Aim away from your own square.",
    };
  }

  return {
    ok: true,
    targets: getAoETargets({
      shape: area.shape,
      origin: caster,
      sizeFt: area.sizeFt,
      direction,
      combatants,
    }),
  };
}

export type SpellRangeVerdict =
  | { ok: true; enforced: true }
  | { ok: true; enforced: false; raw: string | null }
  | { ok: false; code: "OUT_OF_RANGE"; message: string };

export interface SpellRangeInput {
  range: SpellRange;
  caster: GridCombatant;
  /** The aim point for an area spell, or null for a non-area spell. */
  aim: GridPoint | null;
  /** The resolved targets for a non-area spell. Empty for an area spell. */
  targets: readonly GridCombatant[];
}

/**
 * Decides whether the caster can reach where they are aiming.
 *
 * ─── The origin, not the targets ────────────────────────────────────────────
 * For an area spell only the aim point is measured. A Fireball cast at 120 ft
 * has a 20 ft radius and legitimately catches something 140 ft away; measuring
 * the targets would refuse it.
 *
 * For a spell with no area there is no origin to measure, so every resolved
 * target is checked instead. That constrains non-area spells for the first time.
 *
 * One target out of range refuses the whole cast rather than quietly dropping
 * it: dropping would alter the player's selection without telling them, which is
 * the kind of silent mechanical decision this module exists to prevent.
 *
 * A caster-only spell always passes and its aim is ignored — it has no point to
 * choose. An unenforceable range passes reporting `enforced: false`, so the
 * caller can say the rule went unapplied instead of implying it held.
 */
export function checkSpellRange(input: SpellRangeInput): SpellRangeVerdict {
  const { range, caster, aim, targets } = input;

  if (range.kind === "self") return { ok: true, enforced: true };
  if (range.kind === "unenforceable") {
    return { ok: true, enforced: false, raw: range.raw };
  }

  const limitFt = range.kind === "touch" ? TOUCH_REACH_FT : range.feetFromCaster;
  const measured: Array<{ label: string; distanceFt: number }> = aim
    ? [{ label: "that point", distanceFt: minFootprintDistanceFt(caster, aim) }]
    : targets.map((target) => ({
        label: target.id,
        distanceFt: minFootprintDistanceFt(caster, target),
      }));

  const tooFar = measured.find((entry) => entry.distanceFt > limitFt);
  if (!tooFar) return { ok: true, enforced: true };

  return {
    ok: false,
    code: "OUT_OF_RANGE",
    message:
      range.kind === "touch"
        ? `A touch spell needs an adjacent target, and ${tooFar.label} is ` +
          `${tooFar.distanceFt} ft away.`
        : `${tooFar.label} is ${tooFar.distanceFt} ft away and this spell ` +
          `reaches ${limitFt} ft.`,
  };
}
