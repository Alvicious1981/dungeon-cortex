# Spell Range and Targeting Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend enforce how far a spell reaches and whether it may be aimed at anything other than the caster, instead of accepting any aim point the client sends.

**Architecture:** `parseSpellRange` in `lib/rules/spell-resolution-service.ts` turns the SRD's 26 distinct `range` strings into a closed four-case type on `ResolvedSpellEffect`. `lib/rules/spell-targeting.ts` gains `checkSpellRange`, a pure function beside `resolveAreaTargets` that measures footprint-to-footprint distance and returns a verdict. The action route calls it before deriving targets and obeys it.

**Tech Stack:** TypeScript, Next.js App Router, Prisma, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-19-spell-range-authority-design.md`

## Global Constraints

- D&D 5e / SRD 2014 is the only rules baseline. Do not introduce AD&D, OSR, THAC0, descending AC, or gold-for-XP.
- Backend code owns mechanical truth. AI narration only describes already-resolved outcomes.
- 1 grid square = 5 ft. `(x, y)` is the **top-left** corner of a combatant's footprint. `gridDistanceFt` is Chebyshev × 5.
- Modules under `lib/rules/` are pure: no database, no I/O, no clock, no randomness except through `lib/rules/dice`.
- `lib/rules/spell-targeting.ts` must not import `lib/rules/spell-resolution-service.ts` — the service imports Prisma. Shared types live in `lib/rules/geometry.ts`.
- Do not touch UI components. `docs/MILESTONE_V_SPEC.md` §5 forbids it until the backend is done.
- Do not run `prisma migrate`, `db push`, `db seed`, or `db execute`. This plan requires no schema change.
- Range gates the **point of origin**, not the targets. A Fireball at 120 ft has a 20 ft radius and legitimately reaches 140 ft.
- Baseline before starting: **2932 tests in 147 files**; `pnpm typecheck`, `pnpm lint`, `pnpm check-retro`, `pnpm build` clean.
- Full verification: `pnpm test && pnpm typecheck && pnpm lint && pnpm check-retro && pnpm build`

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/geometry.ts` (modify) | Gains `SpellRange` (shared type) and `minFootprintDistanceFt`. Grid mathematics only. |
| `lib/rules/spell-resolution-service.ts` (modify) | Gains `parseSpellRange` beside `parseSpellArea`, and a required `range` field on `ResolvedSpellEffect`. |
| `lib/rules/spell-targeting.ts` (modify) | Gains `checkSpellRange`. Pure composition; no arithmetic of its own. |
| `app/api/campaign/[id]/action/route.ts` (modify) | Calls `checkSpellRange` before deriving targets; logs the unenforceable case. |
| `tests/rules/geometry.test.ts` (modify) | `minFootprintDistanceFt`, including the discriminating footprint case. |
| `tests/rules/spell-resolution-service.test.ts` (modify) | All 26 range strings, the ordering trap, the embedded area. |
| `tests/rules/spell-targeting.test.ts` (modify) | `checkSpellRange` behaviour and refusals. |
| `tests/api/action-intent-contract.test.ts` (modify) | End to end, plus giving existing fixtures a real `range`. |
| `tests/architecture/spell-range-exhaustiveness.test.ts` (create) | Every `SpellRange` kind is handled. |

---

### Task 1: Footprint-to-footprint distance

**Files:**
- Modify: `lib/rules/geometry.ts`
- Test: `tests/rules/geometry.test.ts`

**Interfaces:**
- Consumes: `GridPoint`, `GridCombatant`, `gridDistanceFt`, `getCombatantOccupiedSquares` — all already in `geometry.ts`.
- Produces: `minFootprintDistanceFt(from: GridCombatant, to: GridCombatant | GridPoint): number`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules/geometry.test.ts`:

```ts
describe("minFootprintDistanceFt", () => {
  const medium = (id: string, x: number, y: number): GridCombatant =>
    ({ id, x, y, size: "Medium" })

  it("measures between the nearest squares, not the anchors", () => {
    // A Large caster anchored at (0,0) occupies (0,0),(1,0),(0,1),(1,1). Its
    // nearest square to a target at (8,0) is (1,0) — 7 squares, 35 ft. Measuring
    // anchor to anchor would report 8 squares, 40 ft, and wrongly refuse a
    // 35 ft spell.
    const largeCaster: GridCombatant = { id: "ogre", x: 0, y: 0, size: "Large" }
    expect(minFootprintDistanceFt(largeCaster, medium("t", 8, 0))).toBe(35)
  })

  it("is zero when the footprints overlap", () => {
    expect(minFootprintDistanceFt(medium("a", 3, 3), medium("b", 3, 3))).toBe(0)
  })

  it("counts a diagonal as 5 ft, per the grid rule", () => {
    expect(minFootprintDistanceFt(medium("a", 0, 0), medium("b", 1, 1))).toBe(5)
  })

  it("accepts a bare point as the destination", () => {
    // The aim point of an area spell is a square, not a creature.
    expect(minFootprintDistanceFt(medium("a", 0, 0), { x: 4, y: 0 })).toBe(20)
  })

  it("shrinks as the source creature grows", () => {
    // A Gargantuan creature reaches further from the same anchor, because more
    // of its body is closer. This is the property that makes anchor-measuring
    // wrong rather than merely imprecise.
    const target = medium("t", 10, 0)
    const asMedium = minFootprintDistanceFt(medium("c", 0, 0), target)
    const asGargantuan = minFootprintDistanceFt(
      { id: "c", x: 0, y: 0, size: "Gargantuan" },
      target
    )
    expect(asGargantuan).toBeLessThan(asMedium)
    expect(asMedium).toBe(50)
    expect(asGargantuan).toBe(35)
  })
})
```

Add `minFootprintDistanceFt` to the existing import from `@/lib/rules/geometry`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rules/geometry.test.ts -t "minFootprintDistanceFt"`
Expected: FAIL — `minFootprintDistanceFt is not a function`.

- [ ] **Step 3: Implement it**

Add to `lib/rules/geometry.ts`, after `getCombatantOccupiedSquares`:

```ts
/**
 * The shortest distance in feet between a creature and a target, measured
 * between the nearest squares of their footprints.
 *
 * Anchor-to-anchor is the wrong measure, not merely a rougher one: a Large
 * creature's body extends a square beyond its anchor, so measuring anchors
 * refuses spells the creature can legally reach. The bigger the creature, the
 * bigger the error.
 *
 * The destination may be a bare `GridPoint` — an area spell's aim point is a
 * square, not a creature.
 *
 * @pure — deterministic, no side effects.
 */
export function minFootprintDistanceFt(
  from: GridCombatant,
  to: GridCombatant | GridPoint
): number {
  const fromSquares = getCombatantOccupiedSquares(from)
  const toSquares =
    "size" in to ? getCombatantOccupiedSquares(to) : [to]

  let shortest = Infinity
  for (const a of fromSquares) {
    for (const b of toSquares) {
      const d = gridDistanceFt(a, b)
      if (d < shortest) shortest = d
    }
  }
  return shortest
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/rules/geometry.test.ts`
Expected: PASS, including all pre-existing geometry tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rules/geometry.ts tests/rules/geometry.test.ts
git commit -m "feat(rules): measure distance between footprints, not anchors"
```

---

### Task 2: The `SpellRange` type

**Files:**
- Modify: `lib/rules/geometry.ts`
- Test: none — this task adds a type only, and Task 3 is the first to exercise it.

**Interfaces:**
- Produces:
  ```ts
  export type SpellRange =
    | { kind: "distance"; feetFromCaster: number }
    | { kind: "touch" }
    | { kind: "self" }
    | { kind: "unenforceable"; raw: string | null };
  export const TOUCH_REACH_FT = 5
  ```

- [ ] **Step 1: Add the type**

Add to `lib/rules/geometry.ts`, immediately after the `SpellArea` interface:

```ts
/**
 * How far a spell reaches, normalised from the SRD's free-text `range` field.
 *
 * Lives here rather than in the resolution service for the same reason
 * `SpellArea` does: `spell-targeting.ts` needs the type and must not import a
 * module that imports Prisma.
 *
 * `touch` is its own case although it is mechanically TOUCH_REACH_FT. The
 * comparison is shared, so the duplication is in the name only; what it buys is
 * a message the player can act on — "you have to be adjacent" rather than
 * "out of range".
 *
 * `unenforceable` carries the raw value. Without it a result could say the range
 * went unchecked but not why, and "Ilimitado" (the spell's actual rule) and null
 * (a data gap) are different situations.
 */
export type SpellRange =
  | { kind: "distance"; feetFromCaster: number }
  | { kind: "touch" }
  | { kind: "self" }
  | { kind: "unenforceable"; raw: string | null }

/** A touch spell reaches an adjacent square. */
export const TOUCH_REACH_FT = 5
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean. Nothing consumes the type yet.

- [ ] **Step 3: Commit**

```bash
git add lib/rules/geometry.ts
git commit -m "feat(rules): add the SpellRange type"
```

---

### Task 3: Normalise the SRD range

**Files:**
- Modify: `lib/rules/spell-resolution-service.ts`
- Test: `tests/rules/spell-resolution-service.test.ts`

**Interfaces:**
- Consumes: `SpellRange`, `SpellArea`, `AreaShape` from `geometry.ts` (Task 2 and earlier).
- Produces:
  ```ts
  export function parseSpellRange(raw: unknown): {
    range: SpellRange;
    embeddedArea: SpellArea | null;
  };
  ```
  and a required `range: SpellRange` field on `ResolvedSpellEffect`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules/spell-resolution-service.test.ts`:

```ts
describe("parseSpellRange", () => {
  it.each([
    ["60 pies", 60],
    ["30 pies", 30],
    ["120 pies", 120],
    ["90 pies", 90],
    ["10 pies", 10],
    ["150 pies", 150],
    ["300 pies", 300],
    ["100 pies", 100],
    ["500 pies", 500],
    ["5 pies", 5],
    ["60 feet", 60],
  ])("reads %s as a distance of %i ft", (raw, feet) => {
    expect(parseSpellRange(raw).range).toEqual({
      kind: "distance",
      feetFromCaster: feet,
    });
  });

  it.each([
    ["1 milla", 5280],
    ["500 millas", 2_640_000],
  ])("converts %s to %i ft", (raw, feet) => {
    expect(parseSpellRange(raw).range).toEqual({
      kind: "distance",
      feetFromCaster: feet,
    });
  });

  it.each(["Toque", "Touch", "toque"])("reads %s as touch", (raw) => {
    expect(parseSpellRange(raw).range).toEqual({ kind: "touch" });
  });

  it.each(["Lanzador", "Personal", "Self", "Autolanzado"])(
    "reads %s as caster-only",
    (raw) => {
      expect(parseSpellRange(raw).range).toEqual({ kind: "self" });
    }
  );

  it.each([
    "Lanzador (línea recta de 60 pies)",
    "Lanzador (radio de 5 millas)",
    "Personal (radio de 15 pies)",
  ])("reads %s as caster-only despite containing a number", (raw) => {
    // The ordering trap. A parser that looks for "number + pies" first turns
    // Espíritus Guardianes into a 15 ft range, making a spell that emanates
    // from the caster aimable 15 ft away.
    expect(parseSpellRange(raw).range).toEqual({ kind: "self" });
  });

  it.each(["Vista", "Especial", "Ilimitado"])(
    "reports %s as unenforceable, carrying the raw value",
    (raw) => {
      expect(parseSpellRange(raw).range).toEqual({ kind: "unenforceable", raw });
    }
  );

  it("reports a missing range as unenforceable with a null raw", () => {
    // Distinct from "Ilimitado": that is the spell's rule, this is a data gap.
    expect(parseSpellRange(null).range).toEqual({ kind: "unenforceable", raw: null });
    expect(parseSpellRange(undefined).range).toEqual({ kind: "unenforceable", raw: null });
  });

  it("reports an unrecognised string as unenforceable rather than guessing", () => {
    expect(parseSpellRange("a un tiro de piedra").range).toEqual({
      kind: "unenforceable",
      raw: "a un tiro de piedra",
    });
  });

  it.each([
    ["Personal (radio de 15 pies)", { shape: "sphere", sizeFt: 15 }],
    ["Lanzador (radio de 5 millas)", { shape: "sphere", sizeFt: 26400 }],
    ["Lanzador (línea recta de 60 pies)", { shape: "line", sizeFt: 60 }],
  ])("extracts the area embedded in %s", (raw, area) => {
    // For Controlar el clima and Espíritus Guardianes this is the ONLY place
    // their area lives. Without it, Espíritus Guardianes — an ordinary combat
    // spell — falls to the no-area path and accepts the client's target list.
    expect(parseSpellRange(raw).embeddedArea).toEqual(area);
  });

  it("extracts no area when the range carries none", () => {
    expect(parseSpellRange("60 pies").embeddedArea).toBeNull();
    expect(parseSpellRange("Lanzador").embeddedArea).toBeNull();
    expect(parseSpellRange("Lanzador (algo indescriptible)").embeddedArea).toBeNull();
  });
});
```

Add `parseSpellRange` to the existing import from `@/lib/rules/spell-resolution-service`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rules/spell-resolution-service.test.ts -t "parseSpellRange"`
Expected: FAIL — `parseSpellRange is not a function`.

- [ ] **Step 3: Implement the parser**

Add to `lib/rules/spell-resolution-service.ts`, immediately after `parseSpellArea`, and extend the geometry import to `import type { AreaShape, SpellArea, SpellRange } from "./geometry";`:

```ts
const FEET_PER_MILE = 5280;

/** Every SRD spelling that means "the caster is the origin". */
const SELF_KEYWORDS = ["lanzador", "personal", "self", "autolanzado"];

/** Every SRD spelling that means "an adjacent creature". */
const TOUCH_KEYWORDS = ["toque", "touch"];

/**
 * Reads a distance and its unit, in either language. Returns null when the text
 * is not a plain distance.
 */
function parseDistanceFt(text: string): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(pies|pie|feet|foot|millas|milla|miles|mile)\b/);
  if (!match) return null;

  const amount = Number(match[1]!.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2]!;
  const inMiles = unit.startsWith("milla") || unit.startsWith("mile");
  return inMiles ? amount * FEET_PER_MILE : amount;
}

/**
 * Reads the area some SRD range strings carry in parentheses, e.g.
 * "Personal (radio de 15 pies)".
 *
 * Only two wordings appear in the data — a radius and a straight line. Anything
 * else extracts nothing, which leaves the spell arealess: the behaviour before
 * this parser existed.
 */
function parseEmbeddedArea(text: string): SpellArea | null {
  const inner = text.match(/\(([^)]*)\)/)?.[1];
  if (!inner) return null;

  const sizeFt = parseDistanceFt(inner);
  if (sizeFt === null) return null;

  // "radio" is a radius, which is exactly what `size` means for a sphere in
  // area_of_effect, so the two agree without conversion.
  if (inner.includes("radio") || inner.includes("radius")) {
    return { shape: "sphere" as AreaShape, sizeFt };
  }
  if (inner.includes("línea") || inner.includes("linea") || inner.includes("line")) {
    return { shape: "line" as AreaShape, sizeFt };
  }
  return null;
}

/**
 * Normalises the SRD's free-text `range` into a rule the engine can enforce.
 *
 * ─── Order matters, and it is the trap in this field ─────────────────────────
 * Three of the 26 observed values are caster-only WITH a number inside them:
 * "Personal (radio de 15 pies)" and two siblings. Matching a distance first
 * would classify Espíritus Guardianes as a 15 ft range, making a spell that
 * emanates from the caster aimable 15 ft away. So self and touch are tested
 * before any distance.
 *
 * ─── Why an unknown value is allowed rather than refused ─────────────────────
 * The opposite of parseSpellArea, deliberately. Without an area shape the target
 * set cannot be computed and proceeding would hand selection back to the client.
 * Without a range only one constraint is missing, while the set is still entirely
 * backend-derived. "Ilimitado" is also a real SRD rule, not a data gap, and
 * refusing it would block a legal spell.
 *
 * @pure — deterministic, no side effects.
 */
export function parseSpellRange(raw: unknown): {
  range: SpellRange;
  embeddedArea: SpellArea | null;
} {
  if (typeof raw !== "string" || !raw.trim()) {
    return { range: { kind: "unenforceable", raw: null }, embeddedArea: null };
  }

  const text = raw.trim().toLowerCase();
  const embeddedArea = parseEmbeddedArea(text);

  if (SELF_KEYWORDS.some((word) => text.startsWith(word))) {
    return { range: { kind: "self" }, embeddedArea };
  }
  if (TOUCH_KEYWORDS.some((word) => text.startsWith(word))) {
    return { range: { kind: "touch" }, embeddedArea };
  }

  const feet = parseDistanceFt(text);
  if (feet !== null) {
    return { range: { kind: "distance", feetFromCaster: feet }, embeddedArea };
  }

  return { range: { kind: "unenforceable", raw: raw.trim() }, embeddedArea };
}
```

- [ ] **Step 4: Add the field to `ResolvedSpellEffect`**

Add to the interface, after `unsupportedAreaType`:

```ts
  /** How far this spell reaches, normalised from the SRD text. */
  range: SpellRange;
```

Required, not optional, for the same reason `area` is: a fixture that forgets it
should fail loudly rather than silently resolve as unconstrained.

- [ ] **Step 5: Populate it in `resolveCachedSpell`**

Replace the existing `parsedArea` block with:

```ts
  const spellData = (spell.data as Record<string, unknown> | null) ?? {};
  const parsedArea = parseSpellArea(spellData.area_of_effect);
  const parsedRange = parseSpellRange(spellData.range);
```

and in the returned object replace `area: parsedArea.area,` with:

```ts
    // area_of_effect wins when both exist; the range's parenthetical is the only
    // source for Controlar el clima and Espíritus Guardianes.
    area: parsedArea.area ?? parsedRange.embeddedArea,
    range: parsedRange.range,
```

leaving `unsupportedAreaType: parsedArea.unsupportedType,` as it is.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run tests/rules/spell-resolution-service.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean. If a fixture constructs a `ResolvedSpellEffect` by hand it will fail here — add `range: { kind: "unenforceable", raw: null }` to it rather than making the field optional.

- [ ] **Step 7: Commit**

```bash
git add lib/rules/spell-resolution-service.ts tests/rules/spell-resolution-service.test.ts
git commit -m "feat(rules): normalise the SRD spell range into a closed type"
```

---

### Task 4: The range rule

**Files:**
- Modify: `lib/rules/spell-targeting.ts`
- Test: `tests/rules/spell-targeting.test.ts`

**Interfaces:**
- Consumes: `SpellRange`, `TOUCH_REACH_FT`, `minFootprintDistanceFt`, `GridCombatant`, `GridPoint` — all from `geometry.ts`.
- Produces:
  ```ts
  export type SpellRangeVerdict =
    | { ok: true; enforced: true }
    | { ok: true; enforced: false; raw: string | null }
    | { ok: false; code: "OUT_OF_RANGE"; message: string };
  export function checkSpellRange(input: {
    range: SpellRange;
    caster: GridCombatant;
    /** The aim point for an area spell, or null for a non-area spell. */
    aim: GridPoint | null;
    /** The resolved targets for a non-area spell. Empty for an area spell. */
    targets: readonly GridCombatant[];
  }): SpellRangeVerdict;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules/spell-targeting.test.ts`:

```ts
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
```

Add `checkSpellRange` to the import from `@/lib/rules/spell-targeting`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rules/spell-targeting.test.ts -t "checkSpellRange"`
Expected: FAIL — `checkSpellRange is not a function`.

- [ ] **Step 3: Implement it**

Add to `lib/rules/spell-targeting.ts`, and extend the geometry import with `minFootprintDistanceFt`, `TOUCH_REACH_FT` and `type SpellRange`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/rules/spell-targeting.test.ts`
Expected: PASS, including the six pre-existing `resolveAreaTargets` tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rules/spell-targeting.ts tests/rules/spell-targeting.test.ts
git commit -m "feat(rules): enforce how far a spell reaches"
```

---

### Task 5: Structural guard for range coverage

**Files:**
- Create: `tests/architecture/spell-range-exhaustiveness.test.ts`

**Interfaces:**
- Consumes: `checkSpellRange` (Task 4), `SpellRange` (Task 2).

- [ ] **Step 1: Write the guard**

Create `tests/architecture/spell-range-exhaustiveness.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/architecture/spell-range-exhaustiveness.test.ts`
Expected: PASS for all four kinds.

- [ ] **Step 3: Commit**

```bash
git add tests/architecture/spell-range-exhaustiveness.test.ts
git commit -m "test(architecture): guard that every spell range kind has a rule"
```

---

### Task 6: Wire the gate

**Files:**
- Modify: `app/api/campaign/[id]/action/route.ts` — the `cast_spell` gate, at the block beginning `if (effect.unsupportedAreaType) {` (around line 595) and the area branch at `if (effect.area && context.activeEncounter) {` (around line 611)
- Test: `tests/api/action-intent-contract.test.ts`

**Interfaces:**
- Consumes: `checkSpellRange` (Task 4), `effect.range` (Task 3), `toSizeCategory` (already in the route).

- [ ] **Step 1: Give the existing spell fixtures a real range**

The fixtures in `tests/api/action-intent-contract.test.ts` declare no `range`, so
every one of them would classify as `unenforceable` and sail past the new code
untested. Fireball's SRD range is 150 ft.

In each of the three spell fixtures — `FIREBALL`, `FIREBALL_AREA` (twice, in the
`el área decide` and `una explosión no distingue` describes) — add to `data`:

```ts
      range: "150 pies",
```

and in `MAGIC_MISSILE` add:

```ts
      range: "120 pies",
```

Then move the casters that now sit outside those ranges. Replace every
`x: 40, y: 40` on a caster with:

```ts
x: 10, y: 0,
```

which is 45 ft from the aim point at (1,0) — inside 150 ft and clear of the 20 ft
blast radius. Leave the `x: 10, y: 10` caster in the Magic Missile test as it is:
it is 50 ft from that test's aim, inside 120 ft.

- [ ] **Step 2: Run the file to see the fixtures still pass before adding the check**

Run: `npx vitest run tests/api/action-intent-contract.test.ts`
Expected: PASS. Nothing enforces range yet; this step only proves the fixture edit
broke nothing.

- [ ] **Step 3: Write the failing end-to-end tests**

Append to `tests/api/action-intent-contract.test.ts`:

```ts
describe("el alcance del conjuro lo comprueba el backend", () => {
  /** Fireball as the SRD stores it: 150 ft range, 20 ft radius sphere. */
  const FIREBALL_RANGED = {
    id: "spell_fireball_ranged",
    indexSlug: "fireball",
    name: "Fireball",
    level: 3,
    concentration: false,
    data: {
      damage: { damage_at_slot_level: { "3": "8d6" }, damage_type: { index: "fire" } },
      dc: { dc_type: { index: "dex" }, dc_success: "half" },
      area_of_effect: { type: "sphere", size: 20 },
      range: "150 pies",
    },
  };

  /** Cure Wounds: touch, no area. */
  const CURE_WOUNDS = {
    id: "spell_cure_wounds",
    indexSlug: "cure-wounds",
    name: "Cure Wounds",
    level: 1,
    concentration: false,
    data: {
      heal_at_slot_level: { "1": "1d8" },
      range: "Toque",
    },
  };

  const caster = {
    id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
    conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium",
  };

  const hostile = (id: string, x: number, y: number) => ({
    id, name: `Goblin ${id}`, isPlayer: false, hp: 20, maxHp: 20, ac: 12,
    conditions: [], concentrationSpellId: null, stats: { DEX: 10 },
    x, y, size: "Medium",
  });

  function encounterWith(spell: unknown, combatants: Array<Record<string, unknown>>) {
    (buildCampaignContext as any).mockResolvedValue({
      ...contextFor(),
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants,
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([spell]);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);
  }

  it("rechaza un punto de mira más allá del alcance", async () => {
    // (0,0) to (40,0) is 200 ft; Fireball reaches 150.
    encounterWith(FIREBALL_RANGED, [caster, hostile("t1", 40, 0)]);

    const { res } = await post("I cast Fireball", { targetX: 40, targetY: 0 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "OUT_OF_RANGE" });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("permite un punto de mira al límite, y el radio alcanza más allá", async () => {
    // The aim is exactly 150 ft away; the 20 ft radius legitimately catches a
    // creature 170 ft out. An implementation gating targets instead of the
    // origin refuses this.
    const atLimit = hostile("t1", 30, 0);   // 150 ft — the aim square
    const beyond = hostile("t2", 33, 0);    // 165 ft, inside the 20 ft radius
    encounterWith(FIREBALL_RANGED, [caster, atLimit, beyond]);

    const { res } = await post("I cast Fireball", { targetX: 30, targetY: 0 });

    expect(res.status).toBe(200);
    const updated = (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
    expect(updated).toContain("t2");
  });

  it("un conjuro de toque exige un objetivo adyacente", async () => {
    encounterWith(CURE_WOUNDS, [caster, hostile("t1", 4, 0)]);

    const { res } = await post("I cast Cure Wounds on Goblin t1", {
      targetIds: ["t1"],
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "OUT_OF_RANGE" });
  });

  it("deja constancia cuando el alcance no se pudo comprobar", async () => {
    encounterWith(
      { ...FIREBALL_RANGED, data: { ...FIREBALL_RANGED.data, range: "Ilimitado" } },
      [caster, hostile("t1", 40, 0)]
    );

    const { res } = await post("I cast Fireball", { targetX: 40, targetY: 0 });

    expect(res.status).toBe(200);
    expect(
      systemLogs().some((line) => line.includes("Ilimitado"))
    ).toBe(true);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/api/action-intent-contract.test.ts -t "el alcance del conjuro"`
Expected: FAIL — the out-of-range casts resolve with 200 instead of 400, because
nothing checks range yet.

- [ ] **Step 5: Add the import**

```ts
import { checkSpellRange, resolveAreaTargets } from "@/lib/rules/spell-targeting";
```

replacing the existing single-name import from that module.

- [ ] **Step 6: Insert the check before the target set is derived**

In the `cast_spell` gate, immediately after the `if (effect.unsupportedAreaType)`
block and before `const encounterCombatants = ...`, the code already computes
nothing else. Restructure so the aim is derived first, then the range checked,
then the targets. Replace the block that currently begins
`const encounterCombatants = context.activeEncounter?.combatants ?? [];`
down to and including `targets = encounterCombatants.filter((c) => hitIds.has(c.id));`
with:

```ts
      const encounterCombatants = context.activeEncounter?.combatants ?? [];
      const asGrid = (c: ContextCombatant) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        size: toSizeCategory(c.size),
      });

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
        if (effect.area && named.length > 1) {
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

      let targets: ContextCombatant[] = [];

      // The selection a non-area spell would use, needed by the range check
      // before the area branch decides anything.
      const requestedTargets = body.targetIds?.length
        ? encounterCombatants.filter((c) => body.targetIds!.includes(c.id))
        : intent.targetName
          ? encounterCombatants.filter((c) =>
              c.name.toLowerCase().includes(intent.targetName!.toLowerCase())
            )
          : [];

      // ── Range, before anything is derived ───────────────────────────────────
      // Out of range is the more useful diagnostic and the cheaper one: deriving
      // a set first would report "the spell hit nobody" for a reach problem.
      if (casterCombatant) {
        const rangeVerdict = checkSpellRange({
          range: effect.range,
          caster: asGrid(casterCombatant),
          aim: effect.area ? aim : null,
          targets: effect.area ? [] : requestedTargets.map(asGrid),
        });

        if (!rangeVerdict.ok) {
          return NextResponse.json(
            { error: rangeVerdict.message, code: rangeVerdict.code },
            { status: 400 }
          );
        }

        if (!rangeVerdict.enforced) {
          // Declared rather than silent: a rule that did not apply and left no
          // trace is how a gap survives unnoticed.
          await prisma.gameLog.create({
            data: {
              campaignId,
              role: "system",
              content:
                `⚠️ ${effect.name}: range not verified — the SRD records it as ` +
                `"${rangeVerdict.raw ?? "missing"}", which carries no measurable distance.`,
            },
          });
        }
      }

      if (effect.area && context.activeEncounter) {
        const outcome = resolveAreaTargets({
          area: effect.area,
          aim,
          caster: { x: casterCombatant?.x ?? 0, y: casterCombatant?.y ?? 0 },
          combatants: encounterCombatants.map(asGrid),
        });

        if (!outcome.ok) {
          return NextResponse.json(
            { error: outcome.message, code: outcome.code },
            { status: 400 }
          );
        }

        const hitIds = new Set(outcome.targets.map((t) => t.id));
        targets = encounterCombatants.filter((c) => hitIds.has(c.id));
      } else {
        // Spells with no area still take the caller's selection: the SRD cache
        // stores no target count, so there is no field to validate against.
        // Recorded as a remaining leak in the design doc.
        targets = requestedTargets;
      }
```

Note the two behaviour-preserving details: `AIM_AMBIGUOUS` now only fires for area
spells, because a non-area spell naming two creatures is a legitimate multi-target
selection rather than an ambiguous origin; and `requestedTargets` replaces the two
former `else if` branches, which computed the same thing.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/api/action-intent-contract.test.ts`
Expected: PASS, all of them.

Run: `npx vitest run tests/api/action.test.ts`
Expected: PASS. That file mocks `parseIntent` and drives spells through a mocked
resolution, so it should be unaffected; if a spell test there fails, it is because
its fixture lacks a `range` — add one rather than weakening the assertion.

- [ ] **Step 8: Commit**

```bash
git add "app/api/campaign/[id]/action/route.ts" tests/api/action-intent-contract.test.ts
git commit -m "feat(rules): refuse a spell aimed beyond its reach"
```

---

### Task 7: Full verification and spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-spell-range-authority-design.md` — status line only.

- [ ] **Step 1: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm check-retro && pnpm build`
Expected: all clean, test count above the 2932 baseline. If `pnpm test` reports
failures, re-run the named files in isolation before concluding anything: this
suite has a history of worker-startup timeouts that leave files unexecuted, and an
infrastructure failure is not an assertion failure.

- [ ] **Step 2: Mark the spec implemented**

Change `**Status:** approved design, not yet implemented` to `**Status:** implemented`,
and confirm the "Out, with reasons" list still matches reality — line of sight,
`EncounterMap`, UI, and the narrowed non-area leak should all still be open.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-19-spell-range-authority-design.md
git commit -m "docs(spec): mark spell range authority implemented"
```

- [ ] **Step 4: Run the project's rules guard before opening the PR**

Run the `rules-audit` skill over the diff. It should find that `lib/ai` is
untouched, that the new code holds no Prisma writes, and that range resolution
precedes every mutation and the narration.

---

## What this plan does not do

- **Line of sight.** `Vista` stays unenforceable; no visibility model exists.
- **Target counts.** A single-target spell can still be cast at three creatures that are all in range. The SRD cache stores no count.
- **`EncounterMap` and grid bounds.** Blocked on issue #64.
- **Any UI change.** `MILESTONE_V_SPEC.md` §5.
