# Area-of-Effect Target Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend derive which creatures an area spell hits from grid geometry, instead of applying the spell to whatever combatant IDs the client sent.

**Architecture:** `lib/rules/geometry.ts` keeps all grid mathematics and gains cube and line predicates plus a `getAoETargets` aggregator. `lib/rules/spell-resolution-service.ts` normalises the SRD `area_of_effect` field onto the resolved effect. A new pure module `lib/rules/spell-targeting.ts` composes those two — it picks the predicate and the origin, and returns the target set or a typed refusal. The action route calls it once and stops deciding.

**Tech Stack:** TypeScript, Next.js App Router, Prisma, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-19-aoe-target-authority-design.md`

## Global Constraints

- D&D 5e / SRD 2014 is the only rules baseline. Do not introduce AD&D, OSR, THAC0, descending AC, or gold-for-XP.
- Backend code owns mechanical truth. AI narration only describes already-resolved outcomes.
- 1 grid square = 5 ft. `(x, y)` is the **top-left** corner of a combatant's footprint.
- Modules under `lib/rules/` are pure: no database, no I/O, no clock, no randomness except through `lib/rules/dice`.
- Dependency direction is `lib/ai` → `lib/rules`, never the reverse.
- Do not touch UI components. `docs/MILESTONE_V_SPEC.md` §5 forbids it until the backend is done.
- Do not run `prisma migrate`, `db push`, `db seed`, or `db execute`. This plan requires no schema change.
- Baseline before starting: **2889 tests in 145 files**, `pnpm typecheck`, `pnpm lint`, `pnpm check-retro` and `pnpm build` all clean.
- Full verification command: `pnpm test && pnpm typecheck && pnpm lint && pnpm check-retro && pnpm build`

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/geometry.ts` (modify) | Grid mathematics only. Gains `isInCube`, `isInLine`, `AreaShape`, `getAoETargets`. |
| `lib/rules/spell-resolution-service.ts` (modify) | Gains `SpellArea`, `parseSpellArea`, and two new fields on `ResolvedSpellEffect`. |
| `lib/rules/spell-targeting.ts` (create) | Composition: origin family, predicate choice, refusals. No trigonometry. |
| `app/api/campaign/[id]/action/route.ts` (modify) | Calls `resolveAreaTargets` once for area spells. |
| `tests/rules/geometry.test.ts` (modify) | Shape predicates, aggregator, scale guard. |
| `tests/rules/spell-targeting.test.ts` (create) | Composition and refusals. |
| `tests/rules/spell-resolution-service.test.ts` (modify) | The ten SRD type strings. |
| `tests/api/action-intent-contract.test.ts` (modify) | End-to-end, and the one existing test that must change. |
| `tests/architecture/aoe-shape-exhaustiveness.test.ts` (create) | Every shape has a predicate. |

---

### Task 1: Cube and line predicates

**Files:**
- Modify: `lib/rules/geometry.ts`
- Test: `tests/rules/geometry.test.ts`

**Interfaces:**
- Consumes: `GridPoint`, `chebyshevSquares` (already in `geometry.ts`).
- Produces: `isInCube(point: GridPoint, origin: GridPoint, sizeFt: number): boolean` and `isInLine(point: GridPoint, origin: GridPoint, direction: GridPoint, lengthFt: number): boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules/geometry.test.ts`:

```ts
describe("isInCube", () => {
  const origin = { x: 5, y: 5 };

  it("covers a 3x3 window for a 15 ft cube", () => {
    // 15 ft / 5 = 3 squares per side, centred on the origin.
    expect(isInCube({ x: 5, y: 5 }, origin, 15)).toBe(true);
    expect(isInCube({ x: 4, y: 4 }, origin, 15)).toBe(true);
    expect(isInCube({ x: 6, y: 6 }, origin, 15)).toBe(true);
    expect(isInCube({ x: 3, y: 5 }, origin, 15)).toBe(false);
    expect(isInCube({ x: 5, y: 7 }, origin, 15)).toBe(false);
  });

  it("gives the extra square to the positive side when the side is even", () => {
    // A 10 ft cube is 2 squares wide and cannot centre on one square.
    // The house ruling: the extra square goes +x / +y. Documented in the source.
    expect(isInCube({ x: 5, y: 5 }, origin, 10)).toBe(true);
    expect(isInCube({ x: 6, y: 6 }, origin, 10)).toBe(true);
    expect(isInCube({ x: 4, y: 5 }, origin, 10)).toBe(false);
  });

  it("never collapses below a single square", () => {
    expect(isInCube({ x: 5, y: 5 }, origin, 0)).toBe(true);
    expect(isInCube({ x: 6, y: 5 }, origin, 0)).toBe(false);
  });
});

describe("isInLine", () => {
  const origin = { x: 0, y: 0 };
  const east = { x: 1, y: 0 };

  it("covers squares along the ray up to its length", () => {
    expect(isInLine({ x: 1, y: 0 }, origin, east, 20)).toBe(true);
    expect(isInLine({ x: 4, y: 0 }, origin, east, 20)).toBe(true);
    expect(isInLine({ x: 5, y: 0 }, origin, east, 20)).toBe(false);
  });

  it("excludes the origin square", () => {
    expect(isInLine({ x: 0, y: 0 }, origin, east, 20)).toBe(false);
  });

  it("excludes squares off the 5 ft width", () => {
    expect(isInLine({ x: 2, y: 1 }, origin, east, 20)).toBe(false);
  });

  it("excludes squares behind the caster", () => {
    expect(isInLine({ x: -2, y: 0 }, origin, east, 20)).toBe(false);
  });

  it("refuses a zero-length direction instead of matching everything", () => {
    expect(isInLine({ x: 1, y: 0 }, origin, { x: 0, y: 0 }, 20)).toBe(false);
  });
});
```

Add `isInCube` and `isInLine` to the existing import from `@/lib/rules/geometry` at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rules/geometry.test.ts -t "isInCube"`
Expected: FAIL — `isInCube is not a function`.

- [ ] **Step 3: Implement both predicates**

Add to `lib/rules/geometry.ts`, after `isInCone`:

```ts
// ---------------------------------------------------------------------------
// AoE: Cube
// ---------------------------------------------------------------------------

/**
 * Returns true if `point` lies within a cube of `sizeFt` per side centred on
 * `origin`.
 *
 * ─── A house ruling, stated ─────────────────────────────────────────────────
 * The SRD places a cube's point of origin anywhere on one *face* of the cube,
 * which needs a facing the grid does not carry. Centring on the chosen point is
 * the common table simplification and keeps the shape symmetric.
 *
 * An even-sided cube cannot centre on a single square, so the extra square goes
 * to the +x / +y side. Arbitrary but fixed: an unstated tie-break would make the
 * same cast resolve differently depending on rounding.
 *
 * @pure — deterministic, no side effects.
 */
export function isInCube(
  point: GridPoint,
  origin: GridPoint,
  sizeFt: number
): boolean {
  const side = Math.max(1, Math.round(sizeFt / 5))
  const half = Math.floor((side - 1) / 2)
  const minX = origin.x - half
  const minY = origin.y - half
  return (
    point.x >= minX &&
    point.x <= minX + side - 1 &&
    point.y >= minY &&
    point.y <= minY + side - 1
  )
}

// ---------------------------------------------------------------------------
// AoE: Line
// ---------------------------------------------------------------------------

/** Half of a line's 5 ft width, in feet. */
const LINE_HALF_WIDTH_FT = 2.5

/**
 * Returns true if `point` lies within a 5 ft wide line of `lengthFt`
 * originating at `origin` and running along `direction`.
 *
 * SRD lines emanate from the caster, so the origin square itself is excluded
 * and nothing behind the caster is ever caught.
 *
 * A zero-length `direction` returns false rather than matching everything: a
 * line with no direction is not a line, and silently treating it as one would
 * hit the whole map.
 *
 * @pure — deterministic, no side effects.
 */
export function isInLine(
  point: GridPoint,
  origin: GridPoint,
  direction: GridPoint,
  lengthFt: number
): boolean {
  const dirMag = Math.sqrt(direction.x * direction.x + direction.y * direction.y)
  if (dirMag === 0) return false

  const ux = direction.x / dirMag
  const uy = direction.y / dirMag

  const dx = point.x - origin.x
  const dy = point.y - origin.y

  // Feet travelled along the ray, and feet off it.
  const alongFt = (dx * ux + dy * uy) * 5
  const perpFt = Math.abs(dx * uy - dy * ux) * 5

  return alongFt > 0 && alongFt <= lengthFt && perpFt <= LINE_HALF_WIDTH_FT
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/rules/geometry.test.ts`
Expected: PASS, including the pre-existing sphere and cone tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rules/geometry.ts tests/rules/geometry.test.ts
git commit -m "feat(rules): add cube and line area predicates"
```

---

### Task 2: The `getAoETargets` aggregator

**Files:**
- Modify: `lib/rules/geometry.ts`
- Test: `tests/rules/geometry.test.ts`

**Interfaces:**
- Consumes: `isInSphere`, `isInCone`, `isInCube`, `isInLine`, `getCombatantOccupiedSquares`, `GridCombatant`, `GridPoint`.
- Produces: `export type AreaShape = "sphere" | "cube" | "cone" | "line"`,
  `export interface SpellArea { shape: AreaShape; sizeFt: number }` and
  `getAoETargets(input: { shape: AreaShape; origin: GridPoint; sizeFt: number; direction?: GridPoint; combatants: readonly GridCombatant[] }): GridCombatant[]`.

  `SpellArea` lives here rather than in the resolution service on purpose: it is a
  geometry concept, and putting it in the service would make `spell-targeting.ts`
  import a module that imports Prisma. A type-only import would work at runtime,
  but the boundary would read as though the pure module depends on the database.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules/geometry.test.ts`:

```ts
describe("getAoETargets", () => {
  const at = (id: string, x: number, y: number, size: SizeCategory = "Medium") =>
    ({ id, x, y, size });

  it("returns combatants inside a sphere and omits those outside", () => {
    const combatants = [at("in", 5, 5), at("edge", 7, 5), at("out", 9, 5)];
    const hit = getAoETargets({
      shape: "sphere",
      origin: { x: 5, y: 5 },
      sizeFt: 10,
      combatants,
    });
    expect(hit.map((c) => c.id)).toEqual(["in", "edge"]);
  });

  it("catches a Large creature by its footprint, not its anchor square", () => {
    // A Large creature anchored outside the radius still occupies a square
    // inside it. Testing only the anchor would miss the edge of every blast.
    const large = at("ogre", 7, 5, "Large"); // occupies (7,5),(8,5),(7,6),(8,6)
    const hit = getAoETargets({
      shape: "sphere",
      origin: { x: 5, y: 5 },
      sizeFt: 10,
      combatants: [large],
    });
    expect(hit.map((c) => c.id)).toEqual(["ogre"]);
  });

  it("uses the direction for a cone and ignores creatures behind the caster", () => {
    const combatants = [at("ahead", 3, 0), at("behind", -3, 0)];
    const hit = getAoETargets({
      shape: "cone",
      origin: { x: 0, y: 0 },
      sizeFt: 30,
      direction: { x: 1, y: 0 },
      combatants,
    });
    expect(hit.map((c) => c.id)).toEqual(["ahead"]);
  });

  it("returns nothing for a directional shape with no direction", () => {
    const hit = getAoETargets({
      shape: "line",
      origin: { x: 0, y: 0 },
      sizeFt: 30,
      combatants: [at("target", 2, 0)],
    });
    expect(hit).toEqual([]);
  });

  it("resolves a mile-wide area without walking its squares", () => {
    // The SRD cache holds areas up to 40,000 ft. On a 5 ft grid that is
    // 8,000 x 8,000 = 64 million cells, so an implementation that enumerates
    // the shape hangs here rather than returning. This test does not assert
    // the algorithm directly; it makes the wrong one exhaust the timeout.
    const combatants = [at("near", 1, 1), at("far", 200, 200)];
    const hit = getAoETargets({
      shape: "cube",
      origin: { x: 0, y: 0 },
      sizeFt: 40000,
      combatants,
    });
    expect(hit.map((c) => c.id)).toEqual(["near", "far"]);
  });
});
```

Add `getAoETargets` and `type SizeCategory` to the imports from `@/lib/rules/geometry`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rules/geometry.test.ts -t "getAoETargets"`
Expected: FAIL — `getAoETargets is not a function`.

- [ ] **Step 3: Implement the aggregator**

Add to `lib/rules/geometry.ts`:

```ts
// ---------------------------------------------------------------------------
// AoE: aggregation
// ---------------------------------------------------------------------------

/** The four area shapes the rules engine resolves. */
export type AreaShape = "sphere" | "cube" | "cone" | "line"

/** A spell's area, normalised from the SRD record. */
export interface SpellArea {
  shape: AreaShape
  /** Radius for a sphere, edge for a cube, length for a cone or line. */
  sizeFt: number
}

export interface AoETargetsInput {
  shape: AreaShape
  /** Point-anchored shapes: the chosen point. Directional: the caster's square. */
  origin: GridPoint
  /** Radius for a sphere, edge for a cube, length for a cone or line. */
  sizeFt: number
  /** Required by cone and line; ignored by sphere and cube. */
  direction?: GridPoint
  combatants: readonly GridCombatant[]
}

/**
 * Returns every combatant the area touches.
 *
 * A combatant is caught when ANY square of its footprint falls inside the
 * shape, so a Large creature clipping the edge of a blast is included even
 * though its anchor square is outside.
 *
 * ─── Why this tests creatures, not squares ──────────────────────────────────
 * Areas in the SRD cache reach 40,000 ft. Enumerating a shape that size on a
 * 5 ft grid is 64 million cells; testing each combatant against the shape is
 * bounded by the encounter's size instead. Never invert this loop.
 *
 * A directional shape called without a direction returns nothing rather than
 * guessing a facing.
 *
 * @pure — deterministic, no side effects.
 */
export function getAoETargets(input: AoETargetsInput): GridCombatant[] {
  const { shape, origin, sizeFt, direction, combatants } = input

  const covers = (point: GridPoint): boolean => {
    switch (shape) {
      case "sphere":
        return isInSphere(point, origin, sizeFt)
      case "cube":
        return isInCube(point, origin, sizeFt)
      case "cone":
        return direction ? isInCone(point, origin, direction, sizeFt) : false
      case "line":
        return direction ? isInLine(point, origin, direction, sizeFt) : false
    }
  }

  return combatants.filter((combatant) =>
    getCombatantOccupiedSquares(combatant).some(covers)
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/rules/geometry.test.ts`
Expected: PASS. The mile-wide test should complete in milliseconds.

- [ ] **Step 5: Commit**

```bash
git add lib/rules/geometry.ts tests/rules/geometry.test.ts
git commit -m "feat(rules): aggregate area targets by combatant footprint"
```

---

### Task 3: Structural guard for shape coverage

**Files:**
- Create: `tests/architecture/aoe-shape-exhaustiveness.test.ts`

**Interfaces:**
- Consumes: `AreaShape`, `getAoETargets` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the guard**

Create `tests/architecture/aoe-shape-exhaustiveness.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it passes against Task 2's implementation**

Run: `npx vitest run tests/architecture/aoe-shape-exhaustiveness.test.ts`
Expected: PASS for all four shapes.

- [ ] **Step 3: Commit**

```bash
git add tests/architecture/aoe-shape-exhaustiveness.test.ts
git commit -m "test(architecture): guard that every area shape has a predicate"
```

---

### Task 4: Normalise the SRD area

**Files:**
- Modify: `lib/rules/spell-resolution-service.ts`
- Test: `tests/rules/spell-resolution-service.test.ts`

**Interfaces:**
- Consumes: `AreaShape` and `SpellArea` from Task 2.
- Produces: `export function parseSpellArea(raw: unknown): { area: SpellArea | null; unsupportedType: string | null }`,
  and two new fields on `ResolvedSpellEffect`: `area: SpellArea | null` and `unsupportedAreaType: string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules/spell-resolution-service.test.ts`:

```ts
describe("parseSpellArea", () => {
  it.each([
    ["esfera", "sphere"],
    ["sphere", "sphere"],
    ["cilindro", "sphere"],
    ["cylinder", "sphere"],
    ["cubo", "cube"],
    ["cube", "cube"],
    ["cuadrado", "cube"],
    ["cono", "cone"],
    ["cone", "cone"],
    ["line", "line"],
  ])("maps the SRD type %s to %s", (rawType, shape) => {
    // All ten strings observed in the live SrdSpell table. The column is
    // bilingual with neither language dominant, so both must map.
    const parsed = parseSpellArea({ type: rawType, size: 20 });
    expect(parsed.area).toEqual({ shape, sizeFt: 20 });
    expect(parsed.unsupportedType).toBeNull();
  });

  it("reports no area when the spell has none", () => {
    expect(parseSpellArea(undefined)).toEqual({ area: null, unsupportedType: null });
    expect(parseSpellArea(null)).toEqual({ area: null, unsupportedType: null });
  });

  it("fails closed on a type it does not know", () => {
    // Treating an unknown shape as "no area" would hand target selection back
    // to the client and reopen the hole this work exists to close.
    const parsed = parseSpellArea({ type: "hipercubo", size: 20 });
    expect(parsed.area).toBeNull();
    expect(parsed.unsupportedType).toBe("hipercubo");
  });

  it("fails closed on a size that is not a usable number", () => {
    expect(parseSpellArea({ type: "sphere", size: "veinte" }).area).toBeNull();
    expect(parseSpellArea({ type: "sphere" }).area).toBeNull();
  });
});
```

Add `parseSpellArea` to the imports from `@/lib/rules/spell-resolution-service`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rules/spell-resolution-service.test.ts -t "parseSpellArea"`
Expected: FAIL — `parseSpellArea is not a function`.

- [ ] **Step 3: Implement the parser and widen the effect**

Add to `lib/rules/spell-resolution-service.ts`, and add
`import type { AreaShape, SpellArea } from "./geometry";`, re-exporting the latter for
existing importers with `export type { SpellArea };`:

```ts
/**
 * The ten `area_of_effect.type` strings the live SrdSpell table holds, mapped
 * onto the four shapes the rules engine resolves.
 *
 * The column is bilingual with neither language dominant — 51 Spanish rows
 * against 34 English — so both spellings must be here.
 *
 * Two house rulings, stated rather than implied:
 *   - cylinder/cilindro is a real SRD area whose footprint on a flat grid is a
 *     circle, so it resolves as a sphere of the same radius; height is ignored.
 *   - cuadrado is not an SRD area type and reads as a translation artifact of
 *     "cube", so it maps to cube.
 */
const AREA_TYPE_TO_SHAPE: Record<string, AreaShape> = {
  esfera: "sphere",
  sphere: "sphere",
  cilindro: "sphere",
  cylinder: "sphere",
  cubo: "cube",
  cube: "cube",
  cuadrado: "cube",
  cono: "cone",
  cone: "cone",
  line: "line",
};

/**
 * Reads `area_of_effect` from a cached SRD spell.
 *
 * Returns `unsupportedType` rather than silently reporting "no area" when the
 * type is unrecognised: all ten observed strings are covered, so a new value
 * means the data changed underneath us, and the caller must refuse the cast
 * instead of letting the client choose targets again.
 *
 * @pure — deterministic, no side effects.
 */
export function parseSpellArea(raw: unknown): {
  area: SpellArea | null;
  unsupportedType: string | null;
} {
  if (!raw || typeof raw !== "object") return { area: null, unsupportedType: null };

  const record = raw as Record<string, unknown>;
  const rawType = typeof record.type === "string" ? record.type.trim().toLowerCase() : null;
  const size = record.size;

  if (!rawType) return { area: null, unsupportedType: null };

  const shape = AREA_TYPE_TO_SHAPE[rawType];
  if (!shape) return { area: null, unsupportedType: rawType };

  // The column is untyped JSON, so a size that is not a finite number is not
  // usable geometry. Fail closed for the same reason an unknown shape does.
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return { area: null, unsupportedType: rawType };
  }

  return { area: { shape, sizeFt: size }, unsupportedType: null };
}
```

Add the two fields to `ResolvedSpellEffect`:

```ts
  /** The spell's area, when it has one the engine can resolve. */
  area: SpellArea | null;
  /**
   * Set when the SRD record declares an area whose type is unrecognised. The
   * caller must refuse the cast: the spell has an area, and we do not know
   * its shape.
   */
  unsupportedAreaType: string | null;
```

And populate them in `resolveCachedSpell`, immediately before the returned object:

```ts
  const parsedArea = parseSpellArea(
    (spell.data as Record<string, unknown> | null)?.area_of_effect
  );
```

then add `area: parsedArea.area,` and `unsupportedAreaType: parsedArea.unsupportedType,` to that returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/rules/spell-resolution-service.test.ts`
Expected: PASS, including the pre-existing resolution tests.

- [ ] **Step 5: Run typecheck — the new required fields will break other construction sites**

Run: `npx tsc --noEmit`
Expected: errors anywhere a `ResolvedSpellEffect` is built by hand, most likely in test fixtures. Add `area: null, unsupportedAreaType: null` to each until clean. Do not make the fields optional: a fixture that forgets them should fail loudly rather than resolve as "no area".

- [ ] **Step 6: Commit**

```bash
git add lib/rules/spell-resolution-service.ts tests/rules/spell-resolution-service.test.ts
git commit -m "feat(rules): normalise the SRD area_of_effect onto the resolved spell"
```

---

### Task 5: The `spell-targeting` module

**Files:**
- Create: `lib/rules/spell-targeting.ts`
- Test: `tests/rules/spell-targeting.test.ts`

**Interfaces:**
- Consumes: `SpellArea`, `getAoETargets`, `GridCombatant`, `GridPoint` — all from `geometry.ts` (Task 2). Deliberately nothing from the resolution service, so this module stays clear of Prisma.
- Produces:
  ```ts
  export type SpellTargetingRefusal =
    | "AIM_REQUIRED"
    | "DEGENERATE_DIRECTION";
  export type SpellTargetingResult =
    | { ok: true; targets: GridCombatant[] }
    | { ok: false; code: SpellTargetingRefusal; message: string };
  export function resolveAreaTargets(input: {
    area: SpellArea;
    aim: GridPoint | null;
    caster: GridPoint;
    combatants: readonly GridCombatant[];
  }): SpellTargetingResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/rules/spell-targeting.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rules/spell-targeting.test.ts`
Expected: FAIL — cannot resolve `@/lib/rules/spell-targeting`.

- [ ] **Step 3: Implement the module**

Create `lib/rules/spell-targeting.ts`:

```ts
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
  type GridCombatant,
  type GridPoint,
  type SpellArea,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/rules/spell-targeting.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add lib/rules/spell-targeting.ts tests/rules/spell-targeting.test.ts
git commit -m "feat(rules): derive area spell targets from geometry"
```

---

### Task 6: Wire the action route gate

**Files:**
- Modify: `app/api/campaign/[id]/action/route.ts` — the `cast_spell` gate, at the block beginning `let targets: ContextCombatant[] = [];`
- Test: `tests/api/action-intent-contract.test.ts`

**Interfaces:**
- Consumes: `resolveAreaTargets` (Task 5), `ResolvedSpellEffect.area` and `.unsupportedAreaType` (Task 4).
- Produces: no new exports. The SSE `targets[]` payload now reflects the derived set.

- [ ] **Step 1: Write the failing end-to-end tests**

Append to `tests/api/action-intent-contract.test.ts`, inside the file's top-level scope:

```ts
describe("el área decide a quién alcanza un conjuro, no el cliente", () => {
  /** Fireball as the SRD cache stores it: a 20 ft radius sphere. */
  const FIREBALL_AREA = {
    id: "spell_fireball_area",
    indexSlug: "fireball",
    name: "Fireball",
    level: 3,
    concentration: false,
    data: {
      damage: {
        damage_at_slot_level: { "3": "8d6" },
        damage_type: { index: "fire" },
      },
      dc: { dc_type: { index: "dex" }, dc_success: "half" },
      area_of_effect: { type: "sphere", size: 20 },
    },
  };

  const combatant = (id: string, name: string, x: number, y: number) => ({
    id, name, isPlayer: false, hp: 20, maxHp: 20, ac: 12,
    conditions: [], concentrationSpellId: null, stats: { DEX: 10 },
    x, y, size: "Medium",
  });

  it("ignora un objetivo que el cliente nombró pero está fuera del radio", async () => {
    const near = combatant("t1", "Goblin Cerca", 1, 0);
    const far = combatant("t2", "Goblin Lejos", 40, 0);
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants: [
          { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
            conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium" },
          near, far,
        ],
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);
    (prisma.combatant.findMany as any).mockResolvedValue([near, far]);

    const { res } = await post("I cast Fireball", {
      targetIds: ["t1", "t2"],
      targetX: 1,
      targetY: 0,
    });

    expect(res.status).toBe(200);
    const updated = (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
    expect(updated).toContain("t1");
    expect(updated).not.toContain("t2");
  });

  it("alcanza a quien está dentro del radio aunque el cliente no lo nombrara", async () => {
    const named = combatant("t1", "Goblin Uno", 1, 0);
    const unnamed = combatant("t2", "Goblin Dos", 1, 1);
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants: [
          { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
            conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium" },
          named, unnamed,
        ],
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);
    (prisma.combatant.findMany as any).mockResolvedValue([named, unnamed]);

    const { res } = await post("I cast Fireball", {
      targetIds: ["t1"],
      targetX: 1,
      targetY: 0,
    });

    expect(res.status).toBe(200);
    const updated = (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
    expect(updated).toContain("t2");
  });

  it("rechaza cuando el nombre encaja con varias criaturas", async () => {
    // Distinto de "sin punto de mira": aquí el jugador sí apuntó, pero a algo
    // que no identifica una casilla. Elegir una por él sería adivinar.
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants: [
          { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
            conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium" },
          combatant("t1", "Goblin", 1, 0),
          combatant("t2", "Goblin", 5, 0),
        ],
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);

    const { res } = await post("I cast Fireball on the Goblin");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "AIM_AMBIGUOUS" });
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("rechaza un conjuro de área sin punto al que apuntar", async () => {
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants: [
          { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
            conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium" },
          combatant("t1", "Goblin Uno", 1, 0),
          combatant("t2", "Goblin Dos", 2, 0),
        ],
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);

    const { res } = await post("I cast Fireball");

    expect(res.status).toBe(400);
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api/action-intent-contract.test.ts -t "el área decide"`
Expected: FAIL — the far goblin is damaged, because the gate still applies the client's list verbatim.

- [ ] **Step 3: Replace the gate's target selection**

In `app/api/campaign/[id]/action/route.ts`, add the import:

```ts
import { resolveAreaTargets } from "@/lib/rules/spell-targeting";
```

Then replace the block that currently reads:

```ts
      let targets: ContextCombatant[] = [];
      if (body.targetIds && body.targetIds.length > 0 && context.activeEncounter) {
        targets = context.activeEncounter.combatants.filter(c => body.targetIds!.includes(c.id));
      } else if (intent.targetName && context.activeEncounter) {
        const normalizedTarget = intent.targetName.toLowerCase();
        const found = context.activeEncounter.combatants.find(c => c.name.toLowerCase().includes(normalizedTarget));
        if (found) targets = [found];
      }
```

with:

```ts
      // An area spell's targets are not the caller's to choose. The SRD says
      // the area decides, so the client's list can at most say where to aim.
      if (effect.unsupportedAreaType) {
        return NextResponse.json(
          {
            error:
              `${effect.name} has an area of type "${effect.unsupportedAreaType}", which the ` +
              `rules engine does not know how to resolve.`,
          },
          { status: 400 }
        );
      }

      const encounterCombatants = context.activeEncounter?.combatants ?? [];
      const gridCombatants = encounterCombatants.map((c) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        size: (["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"] as const)
          .includes(c.size as SizeCategory)
          ? (c.size as SizeCategory)
          : ("Medium" as SizeCategory),
      }));

      let targets: ContextCombatant[] = [];

      if (effect.area && context.activeEncounter) {
        // Aim: an explicit square wins; otherwise the named creature's square.
        // The search covers every combatant, not only living hostiles — centring
        // a blast on an ally or a fallen creature is a legal aim.
        let aim: { x: number; y: number } | null = null;
        if (Number.isInteger(body.targetX) && Number.isInteger(body.targetY)) {
          aim = { x: body.targetX!, y: body.targetY! };
        } else {
          const named = intent.targetName
            ? encounterCombatants.filter((c) =>
                c.name.toLowerCase().includes(intent.targetName!.toLowerCase())
              )
            : body.targetIds?.length
              ? encounterCombatants.filter((c) => body.targetIds!.includes(c.id))
              : [];

          // Several candidates and no coordinates: where the caster meant to aim
          // is unknowable, so refuse rather than pick one. Distinct from "no aim
          // at all" because the fix differs — name one creature, or send a square.
          if (named.length > 1) {
            return NextResponse.json(
              {
                error:
                  "That names more than one creature, so the point of origin is ambiguous. " +
                  "Name a single creature or pick a square.",
                code: "AIM_AMBIGUOUS",
              },
              { status: 400 }
            );
          }
          if (named.length === 1) aim = { x: named[0]!.x, y: named[0]!.y };
        }

        const casterCombatant = encounterCombatants.find((c) => c.isPlayer);
        const outcome = resolveAreaTargets({
          area: effect.area,
          aim,
          caster: { x: casterCombatant?.x ?? 0, y: casterCombatant?.y ?? 0 },
          combatants: gridCombatants,
        });

        if (!outcome.ok) {
          return NextResponse.json(
            { error: outcome.message, code: outcome.code },
            { status: 400 }
          );
        }

        const hitIds = new Set(outcome.targets.map((t) => t.id));
        targets = encounterCombatants.filter((c) => hitIds.has(c.id));
      } else if (body.targetIds && body.targetIds.length > 0 && context.activeEncounter) {
        // Spells with no area still take the caller's selection: the SRD cache
        // stores no target count, so there is no field to validate against.
        // Recorded as a remaining leak in the design doc.
        targets = context.activeEncounter.combatants.filter(c => body.targetIds!.includes(c.id));
      } else if (intent.targetName && context.activeEncounter) {
        const normalizedTarget = intent.targetName.toLowerCase();
        const found = context.activeEncounter.combatants.find(c => c.name.toLowerCase().includes(normalizedTarget));
        if (found) targets = [found];
      }
```

`SizeCategory` is already imported in this file from `@/lib/rules/geometry`.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run tests/api/action-intent-contract.test.ts -t "el área decide"`
Expected: PASS, all four.

- [ ] **Step 5: Update the one existing test that now documents the hole**

In the same file, the test `"resuelve contra los dos objetivos seleccionados, no solo el primero"` passes `targetIds: ["t1", "t2"]` with no positions. Under the new rule it asserts the old behaviour — a test documenting the hole, the way an earlier one asserted that `search` reached a gate that did not exist.

Make these four exact edits inside that test.

Rename it, so the title states what it now proves:

```ts
  it("alcanza a las dos criaturas que caen dentro del área", async () => {
```

Give `MAGIC_MISSILE` an area, so it goes through the geometric path:

```ts
    data: {
      damage: {
        damage_at_slot_level: { "1": "1d4+1", "2": "2d4+2" },
        damage_type: { index: "force" },
      },
      area_of_effect: { type: "sphere", size: 20 },
    },
```

Give every combatant a square — the two hostiles inside the radius, the caster at the origin:

```ts
    const hostiles = [
      { id: "t1", name: "Goblin One", isPlayer: false, hp: 10, maxHp: 10, ac: 12, conditions: [], concentrationSpellId: null, stats: { DEX: 10 }, x: 1, y: 0, size: "Medium" },
      { id: "t2", name: "Goblin Two", isPlayer: false, hp: 10, maxHp: 10, ac: 12, conditions: [], concentrationSpellId: null, stats: { DEX: 10 }, x: 1, y: 1, size: "Medium" },
    ];
```

and in the same context, the player:

```ts
          { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14, conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium" },
```

Aim the cast at a square instead of relying on the client's list:

```ts
    const { res, frames } = await post("I cast Magic Missile", {
      targetIds: ["t1", "t2"],
      targetX: 1,
      targetY: 0,
    });
```

The two existing assertions — both combatants updated, and a `COMBAT_CONSEQUENCE` naming two targets — stay exactly as they are. They now pass because the geometry caught both, not because the client asked for both.

- [ ] **Step 6: Run the whole file**

Run: `npx vitest run tests/api/action-intent-contract.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/api/campaign/[id]/action/route.ts" tests/api/action-intent-contract.test.ts
git commit -m "feat(rules): let the area decide who a spell hits, not the caller"
```

---

### Task 7: Verify the pipeline handles the caster and downed creatures in a blast

**Files:**
- Test: `tests/api/action-intent-contract.test.ts`
- Possibly modify: `lib/rules/combat-pipeline.ts` — only if a defect is found.

**Interfaces:**
- Consumes: everything from Tasks 4-6.
- Produces: nothing new. This task either confirms two behaviours or surfaces a defect.

The design flagged this as something to verify rather than assume: the derived set now includes the caster and creatures at 0 hp when the geometry catches them, and neither path is exercised today.

- [ ] **Step 1: Write the tests that exercise both paths**

Append to `tests/api/action-intent-contract.test.ts`:

```ts
describe("una explosión no distingue de quién es", () => {
  const FIREBALL_AREA = {
    id: "spell_fireball_self", indexSlug: "fireball", name: "Fireball",
    level: 3, concentration: false,
    data: {
      damage: { damage_at_slot_level: { "3": "8d6" }, damage_type: { index: "fire" } },
      dc: { dc_type: { index: "dex" }, dc_success: "half" },
      area_of_effect: { type: "sphere", size: 20 },
    },
  };

  it("alcanza al propio lanzador si se sitúa dentro de su radio", async () => {
    // Correcto por reglas y hasta ahora inalcanzable: el conjunto lo elegía el
    // cliente, que jamás se incluía a sí mismo.
    const player = { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
      conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium" };
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants: [player],
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);
    (prisma.combatant.findMany as any).mockResolvedValue([player]);

    const { res } = await post("I cast Fireball", { targetX: 0, targetY: 0 });

    expect(res.status).toBe(200);
    const updated = (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
    expect(updated).toContain("p1");
  });

  it("alcanza a una criatura ya a 0 pv dentro del radio", async () => {
    const downed = { id: "t1", name: "Goblin Caído", isPlayer: false, hp: 0, maxHp: 10,
      ac: 12, conditions: [], concentrationSpellId: null, stats: { DEX: 10 },
      x: 1, y: 0, size: "Medium" };
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants: [
          { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
            conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium" },
          downed,
        ],
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);
    (prisma.combatant.findMany as any).mockResolvedValue([downed]);

    const { res } = await post("I cast Fireball", { targetX: 1, targetY: 0 });

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run them and read the outcome carefully**

Run: `npx vitest run tests/api/action-intent-contract.test.ts -t "una explosión no distingue"`

Three possible outcomes, and they need different responses:
- **Both pass** — the pipeline already handles these. Keep the tests; they now pin the behaviour.
- **A test fails on an assertion** — the pipeline mishandles that case. Fix `lib/rules/combat-pipeline.ts`, do not weaken the test, and do not drop the combatant from the derived set: that would reintroduce the hole from the other side.
- **A test throws** — same as above; an exception on a legal cast is a defect.

- [ ] **Step 3: Commit**

```bash
git add tests/api/action-intent-contract.test.ts lib/rules/combat-pipeline.ts
git commit -m "test(rules): pin how a blast treats the caster and downed creatures"
```

---

### Task 8: Full verification and documentation of what remains

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-aoe-target-authority-design.md` — status line only.

- [ ] **Step 1: Run the full suite**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm check-retro && pnpm build`
Expected: all clean. Test count above the 2889 baseline. If `pnpm test` reports failures, re-run the named files in isolation before concluding anything: the suite has a history of worker-startup timeouts that leave files unexecuted, and an infrastructure failure is not an assertion failure.

- [ ] **Step 2: Mark the spec implemented**

Change the spec's status line from `**Status:** approved design, not yet implemented` to `**Status:** implemented`, and confirm the "Out, with reasons" list still matches reality — spell range, non-area spells, `EncounterMap`, and UI should all still be open.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-19-aoe-target-authority-design.md
git commit -m "docs(spec): mark area target authority implemented"
```

- [ ] **Step 4: Run the project's own rules guard before opening the PR**

Run the `rules-audit` skill over the diff. It checks the Code-is-Law constraint this work exists to enforce, and it should now find the client no longer decides spell targets.

---

## What this plan does not do

Stated so an executor does not add them mid-flight:

- **Spell range from the caster.** `SrdSpell.range` is bilingual free text.
- **Non-area spells.** They keep the caller's list; the SRD cache stores no target count.
- **`EncounterMap` and grid bounds.** Blocked on issue #64.
- **Any UI change.** `MILESTONE_V_SPEC.md` §5.
