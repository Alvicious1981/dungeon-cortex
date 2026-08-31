# Social Checks — SRD Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the social check mechanic conform to D&D 5e/SRD 2014 before anything wires it to a live route.

**Architecture:** The change is mostly subtraction. `resolveSocialCheck` stops being its own dice engine and becomes an adapter over `resolveAbilityCheck` in `lib/rules/ability-check.ts`, which already maps the three Charisma skills, holds the SRD difficulty table, and applies the proficiency bonus. Attitude collapses from five bands to 5e's three, derives from the existing `NPC.disposition` integer, and selects a DC from `DIFFICULTY_DC`. The initial-attitude reaction roll is replaced by seeded derivation.

**Tech Stack:** TypeScript, Zod 4, Vitest 4, Next.js 15, Prisma 6 (no migration in this plan).

**Spec:** `docs/superpowers/specs/2026-08-31-social-checks-srd-conformance-design.md`

## Global Constraints

- D&D 5e/SRD 2014 is the only active rules baseline. No AD&D, OSR, retroclone, THAC0, descending AC, or reaction/loyalty procedures as authoritative mechanics.
- Backend code owns mechanical truth. No caller may supply the magnitude of a mechanical outcome.
- **No migration.** `NPC.disposition` stays `Int?` in the −10..10 range.
- Attitude type is exactly `"Hostile" | "Indifferent" | "Friendly"`.
- Attitude thresholds: `≤ −4` Hostile, `−3..3` Indifferent, `≥ 4` Friendly.
- Attitude DCs, from `DIFFICULTY_DC`: Hostile → `hard` (20), Indifferent → `medium` (15), Friendly → `easy` (10).
- Attitude shift: success `+4`, failure `−4`, clamped to −10..10. **Approach never affects the shift.**
- Criticals are narration, never mechanics. The shift depends on nothing but `success`.
- Run tests with `pnpm exec vitest run <path> --maxWorkers=2`, never bare `pnpm test`.
- Falsify every test: break the line it guards, confirm that test dies, restore.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/social.ts` | Attitude type, thresholds, DC map, Zod schemas |
| `lib/rules/social-logic.ts` | Pure resolution: attitude from disposition, check, shift, initial attitude |
| `lib/memory/formatter.ts` | Narrator context — icons and the secret gate |
| `components/NPCRoster.tsx` | Live UI — drops its duplicate banding |
| `components/social/DialogueOverlay.tsx` | Overlay — attitude comparison replaces a magic number |
| `components/npc/DispositionBadge.tsx` | Dead component, updated in place |
| `lib/rules/social-service.ts` | Dead service, kept compiling |
| `tests/architecture/single-disposition-band.test.ts` | New guard: one banding rule |

---

### Task 1: Attitude type, thresholds and DC map

**Files:**
- Modify: `lib/rules/social.ts:22-30` (replace `DISPOSITION_BANDS`)
- Test: `tests/rules/social.test.ts`

**Interfaces:**
- Consumes: `DIFFICULTY_DC`, `DifficultyBand` from `@/lib/rules/ability-check`
- Produces:
  - `type NpcAttitude = "Hostile" | "Indifferent" | "Friendly"`
  - `const NPC_ATTITUDES: readonly NpcAttitude[]`
  - `const ATTITUDE_DIFFICULTY: Record<NpcAttitude, DifficultyBand>`
  - `const NpcAttitudeSchema: z.ZodEnum`

- [ ] **Step 1: Write the failing test**

Add to `tests/rules/social.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { NPC_ATTITUDES, ATTITUDE_DIFFICULTY, type NpcAttitude } from "@/lib/rules/social";
import { DIFFICULTY_DC } from "@/lib/rules/ability-check";

describe("NPC attitude", () => {
  it("has exactly the three 5e attitudes", () => {
    expect(NPC_ATTITUDES).toEqual(["Hostile", "Indifferent", "Friendly"]);
  });

  it("maps each attitude to its SRD difficulty class", () => {
    expect(DIFFICULTY_DC[ATTITUDE_DIFFICULTY.Hostile]).toBe(20);
    expect(DIFFICULTY_DC[ATTITUDE_DIFFICULTY.Indifferent]).toBe(15);
    expect(DIFFICULTY_DC[ATTITUDE_DIFFICULTY.Friendly]).toBe(10);
  });

  it("draws every DC from the SRD difficulty table", () => {
    const canonical = Object.values(DIFFICULTY_DC) as number[];
    for (const attitude of NPC_ATTITUDES) {
      expect(canonical).toContain(DIFFICULTY_DC[ATTITUDE_DIFFICULTY[attitude]]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/rules/social.test.ts --maxWorkers=2`
Expected: FAIL — `NPC_ATTITUDES` is not exported from `@/lib/rules/social`.

- [ ] **Step 3: Write minimal implementation**

In `lib/rules/social.ts`, delete `DISPOSITION_BANDS` and `DispositionBand`, and add:

```typescript
import { type DifficultyBand } from "@/lib/rules/ability-check";

/**
 * How an NPC currently regards the party.
 *
 * These are 5e's three attitudes. An earlier five-step ladder
 * (Hostile/Unfriendly/Indifferent/Friendly/Helpful) came from 3.5e Diplomacy
 * and is not a 5e construct.
 */
export type NpcAttitude = "Hostile" | "Indifferent" | "Friendly";

export const NPC_ATTITUDES: readonly NpcAttitude[] = [
  "Hostile",
  "Indifferent",
  "Friendly",
] as const;

export const NpcAttitudeSchema = z.enum(["Hostile", "Indifferent", "Friendly"]);

/**
 * The difficulty of talking a creature round, by how it already regards you.
 *
 * Every value resolves through `DIFFICULTY_DC`, so the DCs are the SRD's own
 * Typical Difficulty Classes (20 / 15 / 10) rather than numbers invented here.
 */
export const ATTITUDE_DIFFICULTY: Record<NpcAttitude, DifficultyBand> = {
  Hostile: "hard",
  Indifferent: "medium",
  Friendly: "easy",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/rules/social.test.ts --maxWorkers=2`
Expected: PASS. Other files will not compile yet — that is expected and Tasks 2-6 fix them.

- [ ] **Step 5: Falsify**

Change `Hostile: "hard"` to `Hostile: "very_hard"`. Re-run: the second test must fail and the first must still pass. Restore.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/social.ts tests/rules/social.test.ts
git commit -m "feat(social): three 5e attitudes, with DCs from the SRD table"
```

---

### Task 2: Attitude from disposition, and the bounded shift

**Files:**
- Modify: `lib/rules/social-logic.ts` (replace `getDispositionBand`, `getBandFromD20Total`)
- Test: `tests/rules/social-logic.test.ts`

**Interfaces:**
- Consumes: `NpcAttitude`, `NPC_ATTITUDES` from Task 1
- Produces:
  - `function attitudeFor(disposition: number | null | undefined): NpcAttitude`
  - `function shiftDisposition(disposition: number, success: boolean): number`
  - `const ATTITUDE_SHIFT = 4`

- [ ] **Step 1: Write the failing test**

Add to `tests/rules/social-logic.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { attitudeFor, shiftDisposition } from "@/lib/rules/social-logic";
import { NPC_ATTITUDES } from "@/lib/rules/social";

describe("attitudeFor", () => {
  it("reads the three bands off the stored disposition", () => {
    expect(attitudeFor(-10)).toBe("Hostile");
    expect(attitudeFor(-4)).toBe("Hostile");
    expect(attitudeFor(-3)).toBe("Indifferent");
    expect(attitudeFor(0)).toBe("Indifferent");
    expect(attitudeFor(3)).toBe("Indifferent");
    expect(attitudeFor(4)).toBe("Friendly");
    expect(attitudeFor(10)).toBe("Friendly");
  });

  it("treats an unmet NPC as Indifferent", () => {
    expect(attitudeFor(null)).toBe("Indifferent");
    expect(attitudeFor(undefined)).toBe("Indifferent");
  });
});

describe("shiftDisposition", () => {
  it("clamps to the stored range", () => {
    expect(shiftDisposition(10, true)).toBe(10);
    expect(shiftDisposition(-10, false)).toBe(-10);
  });

  it("moves attitude by at most one step from every starting value", () => {
    for (let d = -10; d <= 10; d++) {
      for (const success of [true, false]) {
        const before = NPC_ATTITUDES.indexOf(attitudeFor(d));
        const after = NPC_ATTITUDES.indexOf(attitudeFor(shiftDisposition(d, success)));
        expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("moves in the direction the outcome dictates", () => {
    expect(shiftDisposition(0, true)).toBeGreaterThan(0);
    expect(shiftDisposition(0, false)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/rules/social-logic.test.ts --maxWorkers=2`
Expected: FAIL — `attitudeFor` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/rules/social-logic.ts`, delete `getDispositionBand` and `getBandFromD20Total`, and add:

```typescript
import { type NpcAttitude } from "@/lib/rules/social";

/** How far one check moves the stored disposition. */
export const ATTITUDE_SHIFT = 4;

const MIN_DISPOSITION = -10;
const MAX_DISPOSITION = 10;

/**
 * The attitude a stored disposition represents.
 *
 * Null means the party has never spoken to this NPC. A stranger is
 * Indifferent — the 5e default — rather than a special fourth state.
 */
export function attitudeFor(disposition: number | null | undefined): NpcAttitude {
  const value = disposition ?? 0;
  if (value <= -4) return "Hostile";
  if (value <= 3) return "Indifferent";
  return "Friendly";
}

/**
 * The disposition after one social check.
 *
 * Success and failure are worth the same in opposite directions, and the
 * approach does not enter it: persuading, deceiving and threatening differ in
 * which skill is rolled, not in what the attempt is worth. Each band is seven
 * points wide, so a shift of four moves attitude by at most one step.
 */
export function shiftDisposition(disposition: number, success: boolean): number {
  const shifted = disposition + (success ? ATTITUDE_SHIFT : -ATTITUDE_SHIFT);
  return Math.max(MIN_DISPOSITION, Math.min(MAX_DISPOSITION, shifted));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/rules/social-logic.test.ts --maxWorkers=2`
Expected: the three new `describe` blocks PASS.

- [ ] **Step 5: Falsify**

Change `ATTITUDE_SHIFT` to `8`. Re-run: "moves attitude by at most one step" must fail. Restore. Then change `value <= 3` to `value <= 4`: the `attitudeFor` band test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/social-logic.ts tests/rules/social-logic.test.ts
git commit -m "feat(social): derive attitude from disposition, and bound the shift"
```

---

### Task 3: The check delegates to the ability-check engine

**Files:**
- Modify: `lib/rules/social.ts` (`SocialCheckInputSchema`, `SocialCheckResultSchema`)
- Modify: `lib/rules/social-logic.ts` (`resolveSocialCheck`, delete `computeSocialDC`)
- Test: `tests/rules/social-logic.test.ts`

**Interfaces:**
- Consumes: `attitudeFor`, `shiftDisposition` (Task 2); `ATTITUDE_DIFFICULTY` (Task 1); `resolveAbilityCheck`, `AbilityCheckActor`, `Skill` from `@/lib/rules/ability-check`
- Produces: `function resolveSocialCheck(input: SocialCheckInput, actor: AbilityCheckActor, disposition: number | null): SocialCheckResult`

- [ ] **Step 1: Write the failing test**

Add to `tests/rules/social-logic.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveSocialCheck } from "@/lib/rules/social-logic";
import { SocialCheckInputSchema } from "@/lib/rules/social";
import type { AbilityCheckActor } from "@/lib/rules/ability-check";

const BASE_ACTOR: AbilityCheckActor = { stats: { CHA: 10 }, level: 1 };

function input(approach: "persuade" | "intimidate" | "deceive" = "persuade") {
  return { npcSeed: "innkeeper_1", approach, intent: "a room for the night" };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSocialCheck — SRD conformance", () => {
  it("takes its DC from the attitude", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.45); // natural 10
    expect(resolveSocialCheck(input(), BASE_ACTOR, -10).dc).toBe(20);
    expect(resolveSocialCheck(input(), BASE_ACTOR, 0).dc).toBe(15);
    expect(resolveSocialCheck(input(), BASE_ACTOR, 10).dc).toBe(10);
  });

  it("adds the proficiency bonus for a proficient character", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.45);
    const plain = resolveSocialCheck(input(), BASE_ACTOR, 0);
    const proficient = resolveSocialCheck(
      input(),
      { ...BASE_ACTOR, skillProficiencies: ["Persuasion"] },
      0
    );
    expect(proficient.proficiencyApplied).toBeGreaterThan(0);
    expect(proficient.total).toBeGreaterThan(plain.total);
  });

  it("rolls the skill the approach names", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.45);
    expect(resolveSocialCheck(input("persuade"), BASE_ACTOR, 0).skill).toBe("Persuasion");
    expect(resolveSocialCheck(input("intimidate"), BASE_ACTOR, 0).skill).toBe("Intimidation");
    expect(resolveSocialCheck(input("deceive"), BASE_ACTOR, 0).skill).toBe("Deception");
  });

  it("gives a natural 20 no special effect when it does not beat the DC", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9999); // natural 20
    // CHA -5 at level 1: 20 - 5 = 15, short of a Hostile DC of 20.
    const result = resolveSocialCheck(input(), { stats: { CHA: 1 }, level: 1 }, -10);
    expect(result.roll).toBe(20);
    expect(result.success).toBe(false);
    expect(result.dispositionAfter).toBeLessThan(result.dispositionBefore);
  });

  it("gives a natural 1 no special effect when it still beats the DC", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // natural 1
    // CHA 30 at level 1: 1 + 10 = 11, past a Friendly DC of 10.
    const result = resolveSocialCheck(input(), { stats: { CHA: 30 }, level: 1 }, 10);
    expect(result.roll).toBe(1);
    expect(result.success).toBe(true);
  });

  it("shifts disposition identically for every approach on the same outcome", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.45);
    const shifts = (["persuade", "intimidate", "deceive"] as const).map((a) => {
      const r = resolveSocialCheck(input(a), BASE_ACTOR, 0);
      return r.dispositionAfter - r.dispositionBefore;
    });
    expect(new Set(shifts).size).toBe(1);
  });
});

describe("SocialCheckInputSchema", () => {
  it("refuses a caller-supplied disposition delta", () => {
    const parsed = SocialCheckInputSchema.safeParse({
      ...input(),
      dispositionDelta: 4,
    });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/rules/social-logic.test.ts --maxWorkers=2`
Expected: FAIL — `resolveSocialCheck` has the old three-argument shape and no `skill` field.

- [ ] **Step 3: Write minimal implementation**

In `lib/rules/social.ts`, replace both social schemas:

```typescript
export const SocialCheckInputSchema = z
  .object({
    npcSeed: z.string().min(1).max(100),
    approach: z.enum(["persuade", "intimidate", "deceive"]),
    intent: z.string().max(200),
  })
  .strict();

export type SocialCheckInput = z.infer<typeof SocialCheckInputSchema>;

export const SocialCheckResultSchema = z.object({
  approach: z.enum(["persuade", "intimidate", "deceive"]),
  skill: z.enum(["Persuasion", "Intimidation", "Deception"]),
  roll: z.number().int(),
  abilityModifier: z.number().int(),
  proficiencyApplied: z.number().int(),
  total: z.number().int(),
  dc: z.number().int(),
  success: z.boolean(),
  attitudeBefore: NpcAttitudeSchema,
  attitudeAfter: NpcAttitudeSchema,
  dispositionBefore: z.number().int().min(-10).max(10),
  dispositionAfter: z.number().int().min(-10).max(10),
});

export type SocialCheckResult = z.infer<typeof SocialCheckResultSchema>;
```

In `lib/rules/social-logic.ts`, delete `computeSocialDC` and replace `resolveSocialCheck`:

```typescript
import { resolveAbilityCheck, type AbilityCheckActor, type Skill } from "@/lib/rules/ability-check";
import { ATTITUDE_DIFFICULTY, type SocialCheckInput, type SocialCheckResult } from "@/lib/rules/social";

const APPROACH_SKILL: Record<SocialCheckInput["approach"], Skill> = {
  persuade: "Persuasion",
  intimidate: "Intimidation",
  deceive: "Deception",
};

/**
 * Resolves one attempt to talk a creature round.
 *
 * The dice, the ability, the proficiency bonus and advantage all come from
 * `resolveAbilityCheck` — this is a Charisma skill check like any other, and
 * reimplementing it here is how the two would come to disagree. What is social
 * about it is only which skill the approach names and where the DC comes from.
 *
 * `isCriticalSuccess` and `isCriticalFailure` are deliberately not read: in 5e
 * a natural 20 or 1 has no special effect on an ability check. The natural
 * roll is reported so narration can mention it, but no rule turns on it.
 */
export function resolveSocialCheck(
  input: SocialCheckInput,
  actor: AbilityCheckActor,
  disposition: number | null
): SocialCheckResult {
  const attitudeBefore = attitudeFor(disposition);
  const skill = APPROACH_SKILL[input.approach];

  const check = resolveAbilityCheck(
    { skill, band: ATTITUDE_DIFFICULTY[attitudeBefore] },
    actor
  );

  const dispositionBefore = disposition ?? 0;
  const dispositionAfter = shiftDisposition(dispositionBefore, check.success);

  return {
    approach: input.approach,
    skill,
    roll: check.roll,
    abilityModifier: check.abilityModifier,
    proficiencyApplied: check.proficiencyApplied,
    total: check.total,
    dc: check.dc,
    success: check.success,
    attitudeBefore,
    attitudeAfter: attitudeFor(dispositionAfter),
    dispositionBefore,
    dispositionAfter,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/rules/social-logic.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Falsify**

Reintroduce a crit branch — `if (check.isCriticalSuccess) dispositionAfter = shiftDisposition(dispositionAfter, true);` — and confirm the two natural-roll tests fail while the DC tests still pass. Restore. Then change `intimidate: "Intimidation"` to `"Persuasion"`: only the skill test may fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/social.ts lib/rules/social-logic.ts tests/rules/social-logic.test.ts
git commit -m "feat(social): resolve a social check as the SRD skill check it is"
```

---

### Task 4: Initial attitude derives from the NPC

**Files:**
- Modify: `lib/rules/social-logic.ts` (replace `establishInitialDisposition`)
- Modify: `lib/rules/social.ts` (`InitialDispositionInputSchema`, `InitialDispositionResultSchema`)
- Test: `tests/rules/social-logic.test.ts`

**Interfaces:**
- Consumes: `pickSeeded` from `@/lib/rules/generators`; `NPCRole` from `@/lib/rules/npc`; `generateNPCPersonality` (already imported in this module)
- Produces: `function initialAttitudeFor(seed: string, role: NPCRole): NpcAttitude`, `const INITIAL_DISPOSITION: Record<NpcAttitude, number>`

- [ ] **Step 1: Write the failing test**

Add to `tests/rules/social-logic.test.ts`:

```typescript
import { initialAttitudeFor, INITIAL_DISPOSITION } from "@/lib/rules/social-logic";
import { attitudeFor } from "@/lib/rules/social-logic";

describe("initialAttitudeFor", () => {
  it("gives the same NPC the same greeting every time", () => {
    const first = initialAttitudeFor("innkeeper_saltmarsh", "commoner");
    for (let i = 0; i < 20; i++) {
      expect(initialAttitudeFor("innkeeper_saltmarsh", "commoner")).toBe(first);
    }
  });

  it("does not depend on any roll", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const low = initialAttitudeFor("gate_guard_north", "guard");
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const high = initialAttitudeFor("gate_guard_north", "guard");
    expect(low).toBe(high);
  });

  it("varies between NPCs of the same role", () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => initialAttitudeFor(`commoner_${i}`, "commoner"))
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("seats each attitude at a disposition that reads back as itself", () => {
    for (const [attitude, disposition] of Object.entries(INITIAL_DISPOSITION)) {
      expect(attitudeFor(disposition)).toBe(attitude);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/rules/social-logic.test.ts --maxWorkers=2`
Expected: FAIL — `initialAttitudeFor` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/rules/social-logic.ts`, delete `establishInitialDisposition` and `getBandFromD20Total`, and add:

```typescript
import { pickSeeded } from "@/lib/rules/generators";
import { type NPCRole } from "@/lib/rules/npc";

/**
 * How a stranger of each role tends to receive the party.
 *
 * Weighted by repetition rather than by a probability table, because
 * `pickSeeded` picks uniformly and the weighting should be visible in the
 * data rather than hidden in arithmetic.
 */
const ATTITUDE_BY_ROLE: Record<NPCRole, readonly NpcAttitude[]> = {
  bandit: ["Hostile", "Hostile", "Indifferent"],
  guard: ["Indifferent", "Indifferent", "Friendly"],
  commoner: ["Indifferent", "Friendly", "Friendly"],
};

/** The stored disposition each attitude starts at — the middle of its band. */
export const INITIAL_DISPOSITION: Record<NpcAttitude, number> = {
  Hostile: -7,
  Indifferent: 0,
  Friendly: 7,
};

/**
 * The attitude an NPC holds the first time the party meets them.
 *
 * Derived from the seed, like every other fact about an NPC, so the same
 * person always greets the party the same way. This replaces a d20 + Charisma
 * roll: that was a reaction roll, which this project does not use as an
 * authoritative mechanic, and it made how a stranger felt about you depend on
 * who happened to be doing the talking.
 */
export function initialAttitudeFor(seed: string, role: NPCRole): NpcAttitude {
  return pickSeeded(seed + ":attitude", ATTITUDE_BY_ROLE[role]);
}
```

Update `InitialDispositionInputSchema` in `lib/rules/social.ts` to `{ npcSeed, npcRole }` with no `charismaModifier`, and `InitialDispositionResultSchema` to `{ attitude: NpcAttitudeSchema, disposition: z.number().int(), personality: … }` keeping the existing personality shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/rules/social-logic.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Falsify**

Change the salt from `":attitude"` to `":att"`. The determinism tests still pass (it is still deterministic) but re-running the full file must show the "varies between NPCs" test still passing — confirming the test is about variation, not about the salt. Then make `initialAttitudeFor` return `pickSeeded(seed + Math.random(), …)`: the determinism and no-roll tests must both fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/social.ts lib/rules/social-logic.ts tests/rules/social-logic.test.ts
git commit -m "feat(social): derive an NPC's opening attitude instead of rolling reaction"
```

---

### Task 5: The narrator's context

**Files:**
- Modify: `lib/memory/formatter.ts:21-22, 451, 460-495`
- Test: `tests/memory/formatter.test.ts`

**Interfaces:**
- Consumes: `attitudeFor` (Task 2), `NpcAttitude` (Task 1)
- Produces: nothing new — this is a consumer

**An existing test conflicts and must be resolved first.**
`tests/memory/formatter.test.ts:153` — "renders visible NPC traits but keeps
secret hidden" — uses the `metNPC` fixture at `disposition: 5` and asserts
both that the output contains `"Friendly"` **and** that the secret is absent.
Under the old five-band scheme 5 was Friendly while the secret needed
`Helpful` (8+), so both held. Under three attitudes, 5 is Friendly and Friendly
is the top band, so the secret is now offered and that assertion is false.

Resolve it by moving the fixture used for the hidden-secret case down to
`disposition: 0` (Indifferent) and asserting `"Indifferent"` there. Do not
delete the test — the behaviour it guards is still real, only its threshold
moved. Note the consequence in the commit: the secret now surfaces from
disposition 4 rather than 8, which is the natural cost of collapsing five
bands to three.

- [ ] **Step 1: Write the failing test**

Add to `tests/memory/formatter.test.ts`, reusing the file's existing `metNPC` fixture:

```typescript
describe("formatNPCContext — attitude", () => {
  it("names the attitude the rules would resolve", () => {
    const line = formatNPCContext({ ...metNPC, disposition: -8 });
    expect(line).toContain("Hostile");
    expect(line).not.toContain("Unfriendly");
    expect(line).not.toContain("Helpful");
  });

  it("withholds the secret below Friendly", () => {
    const line = formatNPCContext({ ...metNPC, disposition: 0 });
    expect(line).toContain("Indifferent");
    expect(line).not.toContain("owe money to people");
  });

  it("offers the secret at Friendly", () => {
    const line = formatNPCContext({ ...metNPC, disposition: 7 });
    expect(line).toContain("owe money to people");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/formatter.test.ts --maxWorkers=2`
Expected: FAIL — the module still imports `getDispositionBand`, which Task 2 deleted.

- [ ] **Step 3: Write minimal implementation**

In `lib/memory/formatter.ts`: import `attitudeFor` from `@/lib/rules/social-logic` and `NpcAttitude` from `@/lib/rules/social` in place of `getDispositionBand` and `DispositionBand`. Reduce `DISPOSITION_ICONS` to `Record<NpcAttitude, string>` with three entries. Replace `getDispositionBand(npc.disposition ?? 0)` with `attitudeFor(npc.disposition)`. Change the secret's gate and its prompt line from `Helpful` to `Friendly`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/formatter.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Falsify**

Change the secret gate to `attitudeFor(...) === "Indifferent"`. The "withholds below Friendly" test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add lib/memory/formatter.ts tests/memory/formatter.test.ts
git commit -m "fix(memory): tell the narrator the attitude the rules resolve"
```

---

### Task 6: The UI reads one banding rule

**Files:**
- Modify: `components/NPCRoster.tsx:96-110, 230-232`
- Modify: `components/social/DialogueOverlay.tsx:4, 38, 339-345`
- Modify: `components/npc/DispositionBadge.tsx:60`
- Test: `tests/components/DispositionBadge.test.tsx`, `tests/components/NPCRoster.test.tsx` if present
- Create: `tests/architecture/single-disposition-band.test.ts`

**Interfaces:**
- Consumes: `attitudeFor` (Task 2), `NpcAttitude` (Task 1)
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

Create `tests/architecture/single-disposition-band.test.ts`, following the shape of `tests/architecture/srd-monster-single-lookup.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("one banding rule", () => {
  it("defines attitudeFor in exactly one module", () => {
    const roots = ["app", "lib", "components"].map((d) => join(process.cwd(), d));
    const definers = roots
      .flatMap((root) => sourceFiles(root))
      .filter((file) => /function\s+attitudeFor\s*\(/.test(readFileSync(file, "utf8")));

    expect(definers.map((f) => f.replace(process.cwd(), "").replace(/\\/g, "/"))).toEqual([
      "/lib/rules/social-logic.ts",
    ]);
  });

  it("leaves no second copy of the old banding thresholds in the UI", () => {
    const components = sourceFiles(join(process.cwd(), "components"));
    for (const file of components) {
      expect(readFileSync(file, "utf8")).not.toMatch(/function\s+getDispositionBand/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/architecture/single-disposition-band.test.ts --maxWorkers=2`
Expected: FAIL — `NPCRoster.tsx` still defines `getDispositionBand`.

- [ ] **Step 3: Write minimal implementation**

In `NPCRoster.tsx`: delete the local `getDispositionBand` (line 104), import `attitudeFor` from `@/lib/rules/social-logic`, call it at both use sites, and reduce `DISPOSITION_COLORS` to three keys — `Hostile: "#ef4444"`, `Indifferent: "#71717a"`, `Friendly: "#22c55e"`.

In `DialogueOverlay.tsx`: import `attitudeFor` and `NpcAttitude`, reduce its colour map to the same three, replace `npc.disposition < 3` at the rumour gate with `attitudeFor(npc.disposition) === "Hostile"`, and delete the stale `rollReaction` comment on line 38.

In `DispositionBadge.tsx`: delete the `rollReaction` mention in the aria-label on line 60, and update its bands to the three. Adjust `tests/components/DispositionBadge.test.tsx` fixtures that assert five bands.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/architecture/single-disposition-band.test.ts tests/components/ --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Falsify**

Paste a `function getDispositionBand(d: number) { return "Friendly"; }` back into `NPCRoster.tsx`. The second architecture assertion must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add components/ tests/architecture/single-disposition-band.test.ts tests/components/
git commit -m "refactor(ui): read one banding rule, and retire the reaction-roll wording"
```

---

### Task 7: Keep the dead service compiling, and prove the suite green

**Files:**
- Modify: `lib/rules/social-service.ts:120-280`
- Modify: `lib/ai/tools/social.ts:130-180` (the two social tool `execute` bodies)
- Test: `tests/rules/social-check-service-contract.test.ts`, `tests/ai/tools/social.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4
- Produces: nothing — this task exists so nothing is left broken

- [ ] **Step 1: Run the full suite to find every remaining break**

Run: `pnpm typecheck` then `pnpm exec vitest run --maxWorkers=2`
Expected: a list of compile errors and failures in `social-service.ts`, `lib/ai/tools/social.ts`, and their tests. Record it before changing anything.

- [ ] **Step 2: Update the service to the new shapes**

`social-service.resolveSocialCheck` passes an `AbilityCheckActor` and the stored disposition through to the pure function instead of a `charismaModifier`, and drops its own `d20Check` branch, `backfire` and `charismaModifier` fields. It stays dead; it only has to compile and keep its contract test meaningful.

In `lib/ai/tools/social.ts`, the `establishInitialDisposition` tool drops its `charismaModifier` argument and calls `initialAttitudeFor`; the `socialCheck` tool drops `dispositionDelta`. These tools have no production caller — the point is only that the module compiles and its tests still assert something true.

- [ ] **Step 3: Update the affected tests**

Fixtures asserting five bands, `backfire`, `charismaModifier` or `dispositionDelta` are updated to the new shapes. Any assertion that becomes unconditionally true is deleted rather than adjusted.

- [ ] **Step 4: Run the full suite**

Run: `pnpm typecheck && pnpm exec vitest run --maxWorkers=2`
Expected: typecheck clean, every test passing. The suite stood at 3456 before this plan.

- [ ] **Step 5: Confirm no reaction-roll vocabulary survives**

Run: `grep -rn "rollReaction\|Unfriendly\|Helpful\|dispositionDelta\|charismaModifier\|backfire" --include=*.ts --include=*.tsx app/ lib/ components/ prisma/`
Expected: no matches. Update `prisma/schema.prisma`'s `disposition` and `hasMetPlayer` doc-comments if they still mention `rollReaction` or legacy reaction rolls — comments only, **no schema change**.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(social): move every remaining caller onto the SRD shapes"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Decision 1 — conform before wiring | The whole plan; nothing touches a route |
| Decision 2 — attitude selects an SRD DC | Task 1 |
| Decision 3 — three 5e attitudes | Tasks 1, 2 |
| Decision 4 — one bounded step, backend-set | Tasks 2, 3 |
| Decision 5 — initial attitude derived | Task 4 |
| Criticals become narration | Task 3, steps 1 and 5 |
| `DISPOSITION_BANDS` retired | Tasks 1, 4 |
| `NPCRoster` duplicate deleted | Task 6 |
| `rollReaction` wording | Tasks 6, 7 |
| Formatter icons and secret gate | Task 5 |
| `social-service` keeps compiling | Task 7 |
| Architecture guard | Task 6 |

Every spec requirement has a task. `check-retro` scope extension is listed out of scope in the spec and is correctly absent here.

**Type consistency:** `attitudeFor`, `shiftDisposition`, `initialAttitudeFor`, `ATTITUDE_SHIFT`, `INITIAL_DISPOSITION`, `NpcAttitude`, `NPC_ATTITUDES`, `ATTITUDE_DIFFICULTY`, `NpcAttitudeSchema` are each defined once and used with the same names and signatures throughout.

**Known risk carried into execution:** Task 7's blast radius is discovered rather than enumerated — the plan cannot list every fixture in `social-check-service-contract.test.ts` and `social.test.ts` without reading them at execution time. Step 1 exists to make that list before any edit.

**Behaviour change to state in the handover:** the NPC secret in the narrator's
context now surfaces from disposition 4 rather than 8. Collapsing five bands to
three makes Friendly the top band, and the secret was gated on the top band.
The gate did not loosen by accident; it loosened because the ladder it sat on
got shorter. If that is unwanted, the fix is a separate threshold rather than a
fourth attitude.
