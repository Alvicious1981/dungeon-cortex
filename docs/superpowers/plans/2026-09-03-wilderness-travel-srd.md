# SRD 2014 Wilderness Travel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the party travel to a location it already knows, costing days of marching, and let a forced march raise SRD exhaustion.

**Architecture:** One pure rule module derives the journey; one gate in the existing action route persists its outcome inside a single transaction. No new service, no new table, no migration. The narrator learns of the journey through a deterministic system log line, the channel it already reads.

**Tech Stack:** TypeScript, Next.js 15 App Router, Prisma 6, Zod 4, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-03-wilderness-travel-srd-design.md`

## Global Constraints

- **D&D 5e/SRD 2014 is the only rules baseline.** No hexes, no watches, no ten-minute dungeon turns. See §1 of the spec.
- **Backend owns mechanical truth.** Every number in the log line is resolved before the line is written; the narrator describes, never decides.
- **No migration.** Nothing in this plan adds a column or a table. If a task seems to need one, stop and report.
- **Verification gates, in order, before any commit is called done:** `pnpm typecheck` → `pnpm lint` → `pnpm exec vitest run <files> --maxWorkers=1`. Never bare `pnpm test`. `pnpm lint` is not optional: it is the gate that owns unused imports, and `pnpm typecheck` does not see them.
- **Falsification is part of every task.** After a test passes, break the exact wire it claims to cover and confirm *that* test fails and its neighbours do not. Restore, then commit. A test that survives its cut does not cover what it claims.
- **`pnpm build`** must pass before the final commit of the last task.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/travel.ts` *(create)* | Pure SRD travel rule: distance from seeds, days, forced-march saves, exhaustion gained. No I/O. |
| `tests/rules/travel.test.ts` *(create)* | Unit tests for the rule. |
| `lib/ai/intent.ts` *(modify)* | Adds `travel` to the action-type enum, a `forceMarch` flag, and a deterministic parse branch. |
| `tests/ai/intent.test.ts` *(modify)* | Classification tests for the new branch. |
| `app/api/campaign/[id]/action/route.ts` *(modify)* | The `travel` gate: resolve destination, call the rule, persist in one transaction. |
| `tests/api/travel-route.test.ts` *(create)* | Route-level tests for the gate. |
| `lib/memory/formatter.ts` *(modify)* | Removes the watches line from the Iron Laws. |
| `tests/memory/formatter.test.ts` *(modify)* | Pins the absence of that line. |

**Why only three tasks.** `tests/architecture/intent-gate-exhaustiveness.test.ts` asserts in **both** directions: every schema action type except `general` must have a gate, and no gate may test an action type the schema cannot emit. Adding `travel` to the enum without its gate leaves the tree red, and adding the gate first is equally impossible. Intent and gate therefore land in one task. They are not separable, and a reviewer could not accept one without the other.

---

### Task 1: The travel rule

**Files:**
- Create: `lib/rules/travel.ts`
- Test: `tests/rules/travel.test.ts`

**Interfaces:**
- Consumes: `seededFloat(seed: string, salt?: number): number` from `@/lib/rules/generators` (returns a float in `[0, 1)`); `resolveSavingThrow(abilityMod: number, dc: number, advantage?: boolean, disadvantage?: boolean): { success: boolean; roll: number; total: number }` from `@/lib/rules/combat`.
- Produces: `travelDistanceMiles(seedA: string, seedB: string): number`; `resolveJourney(input: { distanceMiles: number; forceMarch: boolean; conModifier: number; currentExhaustion: number }): JourneyOutcome`; the constants `MILES_PER_DAY_NORMAL`, `TRAVEL_HOURS_PER_DAY`, `MAX_EXHAUSTION`; and the types `JourneyOutcome` and `ForcedMarchSave`. Task 2 uses all of these.

- [ ] **Step 1: Write the failing tests**

Create `tests/rules/travel.test.ts`:

```typescript
/**
 * tests/rules/travel.test.ts
 *
 * SRD 2014 overland travel. See
 * docs/superpowers/specs/2026-09-03-wilderness-travel-srd-design.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  travelDistanceMiles,
  resolveJourney,
  MILES_PER_DAY_NORMAL,
  TRAVEL_HOURS_PER_DAY,
  MAX_EXHAUSTION,
  MIN_JOURNEY_MILES,
  MAX_JOURNEY_MILES,
} from "@/lib/rules/travel";

/** Forces every d20 to `value`, so saving throws are decided by the test. */
function fixD20(value: number): void {
  vi.spyOn(Math, "random").mockImplementation(() => (value - 1) / 20);
}

describe("travelDistanceMiles", () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * A journey has no direction. If the seeds were concatenated unsorted, the
   * return leg would be a different distance from the outbound one.
   */
  it("is symmetric: the return leg is the same journey", () => {
    expect(travelDistanceMiles("loc_a", "loc_b")).toBe(
      travelDistanceMiles("loc_b", "loc_a")
    );
  });

  it("is deterministic for the same pair", () => {
    expect(travelDistanceMiles("loc_a", "loc_b")).toBe(
      travelDistanceMiles("loc_a", "loc_b")
    );
  });

  /**
   * The control for symmetry: different pairs must not all collapse to one
   * value, or the symmetry test would pass on a constant.
   */
  it("gives different pairs different distances", () => {
    const distances = new Set([
      travelDistanceMiles("loc_a", "loc_b"),
      travelDistanceMiles("loc_a", "loc_c"),
      travelDistanceMiles("loc_b", "loc_c"),
      travelDistanceMiles("loc_d", "loc_e"),
    ]);
    expect(distances.size).toBeGreaterThan(1);
  });

  it("stays within the declared bounds", () => {
    for (let i = 0; i < 200; i++) {
      const miles = travelDistanceMiles(`seed_${i}`, `other_${i}`);
      expect(miles).toBeGreaterThanOrEqual(MIN_JOURNEY_MILES);
      expect(miles).toBeLessThanOrEqual(MAX_JOURNEY_MILES);
    }
  });
});

describe("resolveJourney — normal travel", () => {
  afterEach(() => vi.restoreAllMocks());

  const normal = (distanceMiles: number) =>
    resolveJourney({
      distanceMiles,
      forceMarch: false,
      conModifier: 0,
      currentExhaustion: 0,
    });

  it("covers a day's march in one day", () => {
    expect(normal(MILES_PER_DAY_NORMAL).days).toBe(1);
  });

  it("takes a second day for one mile more", () => {
    expect(normal(MILES_PER_DAY_NORMAL + 1).days).toBe(2);
  });

  it("never costs exhaustion, however long the road", () => {
    const outcome = normal(48);
    expect(outcome.days).toBe(2);
    expect(outcome.exhaustionGained).toBe(0);
    expect(outcome.forcedHours).toBe(0);
    expect(outcome.saves).toEqual([]);
  });
});

describe("resolveJourney — forced march", () => {
  afterEach(() => vi.restoreAllMocks());

  const forced = (distanceMiles: number, conModifier = 0, currentExhaustion = 0) =>
    resolveJourney({ distanceMiles, forceMarch: true, conModifier, currentExhaustion });

  it("takes one day, whatever the distance", () => {
    fixD20(20);
    expect(forced(48).days).toBe(1);
  });

  /**
   * SRD: nothing is forced until the ninth hour. At the normal pace a day's
   * march is exactly eight hours, so a journey of 24 miles or less has nothing
   * to force even when the player asks for it.
   */
  it("forces nothing at or under a full day's march", () => {
    fixD20(1);
    const outcome = forced(MILES_PER_DAY_NORMAL);
    expect(outcome.hours).toBe(TRAVEL_HOURS_PER_DAY);
    expect(outcome.forcedHours).toBe(0);
    expect(outcome.exhaustionGained).toBe(0);
  });

  /**
   * SRD: "The DC is 10 + 1 for each hour past 8 hours." The ninth hour is the
   * first past eight, so DC 11.
   */
  it("raises the DC by one per hour past the eighth", () => {
    fixD20(20);
    const outcome = forced(36); // 36 / 3 mph = 12 hours → 4 forced
    expect(outcome.hours).toBe(12);
    expect(outcome.forcedHours).toBe(4);
    expect(outcome.saves.map((s) => s.dc)).toEqual([11, 12, 13, 14]);
    expect(outcome.saves.map((s) => s.hour)).toEqual([9, 10, 11, 12]);
  });

  it("gains one exhaustion level per failed save", () => {
    fixD20(1); // a natural 1 fails every DC at +0
    const outcome = forced(36);
    expect(outcome.saves.every((s) => !s.success)).toBe(true);
    expect(outcome.exhaustionGained).toBe(4);
  });

  it("gains nothing when every save succeeds", () => {
    fixD20(20);
    const outcome = forced(36);
    expect(outcome.saves.every((s) => s.success)).toBe(true);
    expect(outcome.exhaustionGained).toBe(0);
  });

  /**
   * SRD exhaustion runs to 6 and stops there. What happens AT 6 is death,
   * which this game does not implement — recorded in §7 of the spec, not
   * silently avoided by capping lower.
   */
  it("never carries the character past exhaustion 6", () => {
    fixD20(1);
    const outcome = forced(48, 0, 4); // 16 h → 8 forced hours, all failed
    expect(outcome.exhaustionGained).toBe(MAX_EXHAUSTION - 4);
  });

  it("gains nothing when the character is already at the maximum", () => {
    fixD20(1);
    expect(forced(48, 0, MAX_EXHAUSTION).exhaustionGained).toBe(0);
  });

  /**
   * The modifier must reach the roll. Without this a rule that ignored
   * `conModifier` would pass every other test here.
   */
  it("applies the Constitution modifier to the save", () => {
    fixD20(10);
    const weak = forced(36, 0);
    const hardy = forced(36, +5);
    expect(weak.saves[0]!.total).toBe(10);
    expect(hardy.saves[0]!.total).toBe(15);
    expect(weak.saves[0]!.success).toBe(false); // 10 vs DC 11
    expect(hardy.saves[0]!.success).toBe(true); // 15 vs DC 11
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/rules/travel.test.ts --maxWorkers=1`
Expected: FAIL — `Failed to resolve import "@/lib/rules/travel"`.

- [ ] **Step 3: Write the implementation**

Create `lib/rules/travel.ts`:

```typescript
/**
 * lib/rules/travel.ts
 *
 * SRD 2014 overland travel. Pure: no I/O, no Prisma, deterministic for the
 * same inputs.
 *
 * The canonical decision this implements — SRD travel, explicitly not a
 * hexcrawl — is recorded in
 * docs/superpowers/specs/2026-09-03-wilderness-travel-srd-design.md.
 */
import { seededFloat } from "@/lib/rules/generators";
import { resolveSavingThrow } from "@/lib/rules/combat";

/** SRD normal travel pace: 3 miles per hour. */
export const MILES_PER_HOUR_NORMAL = 3;

/** SRD travel day: eight hours of marching. Beyond this the march is forced. */
export const TRAVEL_HOURS_PER_DAY = 8;

/** 24 miles — what eight hours at the normal pace covers. */
export const MILES_PER_DAY_NORMAL = MILES_PER_HOUR_NORMAL * TRAVEL_HOURS_PER_DAY;

/** Journey distance bounds, inclusive. */
export const MIN_JOURNEY_MILES = 12;
export const MAX_JOURNEY_MILES = 48;

/** SRD exhaustion runs 1..6. Level 6 is death, which this game does not model. */
export const MAX_EXHAUSTION = 6;

export interface ForcedMarchSave {
  /** Absolute hour of the march: the first forced hour is the ninth. */
  hour: number;
  dc: number;
  roll: number;
  total: number;
  success: boolean;
}

export interface JourneyOutcome {
  distanceMiles: number;
  days: number;
  /**
   * Hours marched on the heaviest day. For normal travel this is the SRD
   * eight-hour day; the final day may be shorter, which is not tracked because
   * nothing consumes it.
   */
  hours: number;
  forcedHours: number;
  saves: ForcedMarchSave[];
  exhaustionGained: number;
}

/**
 * Distance between two locations, derived from their seeds.
 *
 * `Location` has neither coordinates nor a distance column, and this adds
 * none: deriving from a seed is the convention the repository already uses for
 * location names and loot flavour.
 */
export function travelDistanceMiles(seedA: string, seedB: string): number {
  // Sorted before seeding: a journey has no direction, so the return leg must
  // measure the same as the outbound one.
  const [first, second] = [seedA, seedB].sort();
  const span = MAX_JOURNEY_MILES - MIN_JOURNEY_MILES + 1;
  return (
    MIN_JOURNEY_MILES +
    Math.floor(seededFloat(`${first}->${second}:distance`) * span)
  );
}

/**
 * Resolves a journey.
 *
 * Normal travel costs days and nothing else — camping between them is assumed
 * and needs no state. A forced march covers the whole distance in one day, and
 * every hour past the eighth is an SRD Constitution save at DC 10 + 1 per hour
 * past eight; each failure is one level of exhaustion.
 *
 * Never throws.
 */
export function resolveJourney(input: {
  distanceMiles: number;
  forceMarch: boolean;
  conModifier: number;
  currentExhaustion: number;
}): JourneyOutcome {
  const { distanceMiles, forceMarch, conModifier, currentExhaustion } = input;

  if (!forceMarch) {
    return {
      distanceMiles,
      days: Math.ceil(distanceMiles / MILES_PER_DAY_NORMAL),
      hours: TRAVEL_HOURS_PER_DAY,
      forcedHours: 0,
      saves: [],
      exhaustionGained: 0,
    };
  }

  const hours = Math.ceil(distanceMiles / MILES_PER_HOUR_NORMAL);
  const forcedHours = Math.max(0, hours - TRAVEL_HOURS_PER_DAY);
  const saves: ForcedMarchSave[] = [];
  let failed = 0;

  for (let past = 1; past <= forcedHours; past++) {
    const dc = 10 + past;
    // Delegated, not reimplemented: SRD saving throws already have exactly one
    // implementation and this does not become a second.
    const { success, roll, total } = resolveSavingThrow(conModifier, dc);
    saves.push({ hour: TRAVEL_HOURS_PER_DAY + past, dc, roll, total, success });
    if (!success) failed += 1;
  }

  const headroom = Math.max(0, MAX_EXHAUSTION - currentExhaustion);

  return {
    distanceMiles,
    days: 1,
    hours,
    forcedHours,
    saves,
    exhaustionGained: Math.min(failed, headroom),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/rules/travel.test.ts --maxWorkers=1`
Expected: PASS, 13 tests.

- [ ] **Step 5: Falsify each wire**

Make each change, run the suite, confirm **only** the named test fails, then restore.

| Change | Must kill, and nothing else |
| --- | --- |
| `const [first, second] = [seedA, seedB];` (drop `.sort()`) | "is symmetric: the return leg is the same journey" |
| `const dc = 11;` | "raises the DC by one per hour past the eighth" |
| `resolveSavingThrow(0, dc)` (drop `conModifier`) | "applies the Constitution modifier to the save" |
| `exhaustionGained: failed` (drop the headroom clamp) | "never carries the character past exhaustion 6" **and** "gains nothing when the character is already at the maximum" |

If a change kills nothing, that test does not cover what it claims — fix the test before continuing.

- [ ] **Step 6: Run the gates and commit**

```bash
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/rules/travel.test.ts --maxWorkers=1
git add lib/rules/travel.ts tests/rules/travel.test.ts
git commit -m "feat(rules): SRD 2014 overland travel

Distance derived from the two location seeds, sorted so a journey has no
direction. Normal travel costs days and nothing else; a forced march
covers the distance in one day and pays for every hour past the eighth
with an SRD Constitution save at DC 10 + 1 per hour, one exhaustion level
per failure.

Saves delegate to resolveSavingThrow rather than rolling here: SRD saving
throws already have one implementation and this does not become a second.

Exhaustion is clamped to 6, the SRD maximum. What happens at 6 is death,
which this game does not implement — recorded in the spec rather than
avoided by capping lower.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The `travel` intent and its gate

**Files:**
- Modify: `lib/ai/intent.ts` — the `actionType` enum (~line 53), a new `forceMarch` field, and a new parse branch immediately before the `move` branch (~line 244)
- Modify: `tests/ai/intent.test.ts`
- Modify: `app/api/campaign/[id]/action/route.ts` — a new gate immediately before the `move` gate (~line 1190)
- Create: `tests/api/travel-route.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produced — `travelDistanceMiles`, `resolveJourney`, `JourneyOutcome`.
- Produces: nothing later tasks depend on. Task 3 is independent.

**These land together on purpose.** `tests/architecture/intent-gate-exhaustiveness.test.ts` asserts that every schema action type except `general` has a gate, **and** that no gate tests a type the schema cannot emit. Either half alone leaves the tree red.

- [ ] **Step 1: Write the failing intent tests**

Add to `tests/ai/intent.test.ts`:

```typescript
describe("parseIntent — travel", () => {
  it("classifies an English journey and extracts the destination", async () => {
    const intent = await parseIntent("travel to the Gilded Boar", "");
    expect(intent.actionType).toBe("travel");
    expect(intent.destination).toBe("Gilded Boar");
    expect(intent.forceMarch).toBe(false);
  });

  it("classifies a Spanish journey", async () => {
    const intent = await parseIntent("viajar a la Cripta Sable", "");
    expect(intent.actionType).toBe("travel");
    expect(intent.destination).toBe("Cripta Sable");
  });

  it("reads a forced march as a choice, not a destination", async () => {
    const intent = await parseIntent("travel to the Gilded Boar, forced march", "");
    expect(intent.actionType).toBe("travel");
    expect(intent.destination).toBe("Gilded Boar");
    expect(intent.forceMarch).toBe(true);
  });

  /**
   * "go to" is movement inside a location and must keep reaching the `move`
   * gate. Travel needs its own verb, or every room change becomes a journey.
   */
  it("leaves in-location movement alone", async () => {
    const intent = await parseIntent("go to the Common Room", "");
    expect(intent.actionType).toBe("move");
  });

  /**
   * Fail closed: a phrasing this parser cannot classify must go back for
   * clarification, never be guessed into a destination.
   */
  it("refuses to guess a destination it cannot read", async () => {
    const intent = await parseIntent("travel", "");
    expect(intent.actionType).toBe("mechanical_ambiguous");
  });
});
```

- [ ] **Step 2: Run the intent tests to verify they fail**

Run: `pnpm exec vitest run tests/ai/intent.test.ts --maxWorkers=1`
Expected: FAIL — the first four expect `"travel"` and receive `"mechanical_ambiguous"`.

- [ ] **Step 3: Extend the intent schema**

In `lib/ai/intent.ts`, add `"travel"` to the `actionType` enum, immediately after `"move"`:

```typescript
  actionType: z.enum([
    "cast_spell",
    "attack",
    "use_item",
    "equip",
    "rest",
    "move",
    "travel",
    "ability_check",
    "mechanical_ambiguous",
    "general",
  ]),
```

Then add the field, immediately after the `destination` field (~line 119):

```typescript
  /**
   * Whether the player chose to push through instead of camping.
   * Only meaningful when actionType is "travel". A forced march covers the
   * journey in one day and pays SRD Constitution saves for every hour past the
   * eighth; absent or false means the ordinary eight-hour days.
   */
  forceMarch: z.boolean().optional(),
```

- [ ] **Step 4: Add the parse branch**

In `lib/ai/intent.ts`, insert this branch **immediately before** the `} else if (` that begins the `move` branch (the one testing `/^(?:i\s+)?(?:move|go|walk)\s+to\b/i`):

```typescript
  } else if (
    /^(?:i\s+)?(?:travel|journey)\s+to\b/i.test(input) ||
    /^(?:viajar|viajo)\s+(?:a|hacia)\b/i.test(input)
  ) {
    // Its own verbs, deliberately not sharing "go to" with the move branch:
    // movement inside a location and a journey between them are different
    // gates, and one wrong guess sends the party days away.
    intent = {
      actionType: "travel",
      destination: prefixedValue(
        /^(?:i\s+)?(?:travel|journey)\s+to\s+(.+?)(?:\s*,\s*(?:forced\s+march|pushing\s+on|without\s+rest))?$|^(?:viajar|viajo)\s+(?:a|hacia)\s+(.+?)(?:\s*,\s*(?:marcha\s+forzada|sin\s+descanso))?$/i
      ),
      forceMarch:
        /\b(?:forced\s+march|pushing\s+on|without\s+rest|marcha\s+forzada|sin\s+descanso)\b/i.test(
          input
        ),
    };
```

- [ ] **Step 5: Run the intent tests to verify they pass**

Run: `pnpm exec vitest run tests/ai/intent.test.ts --maxWorkers=1`
Expected: PASS.

Then run the guard, which must now be **red** — the schema can emit `travel` and no gate handles it:

Run: `pnpm exec vitest run tests/architecture/intent-gate-exhaustiveness.test.ts --maxWorkers=1`
Expected: FAIL on "toda clasificación mecánica del esquema tiene una puerta en la ruta". This red is the guard doing its job; Step 7 clears it.

- [ ] **Step 6: Write the failing route tests**

Create `tests/api/travel-route.test.ts`:

```typescript
/**
 * tests/api/travel-route.test.ts
 *
 * The travel gate. See
 * docs/superpowers/specs/2026-09-03-wilderness-travel-srd-design.md.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn(), update: vi.fn() },
    location: { findFirst: vi.fn(), findUnique: vi.fn() },
    locationNode: { findFirst: vi.fn() },
    character: { update: vi.fn() },
    gameLog: { create: vi.fn(), count: vi.fn(() => 1), findMany: vi.fn(() => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaTx)),
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(async () => ({ id: "user_1" })),
  AuthError: class extends Error {},
}));
vi.mock("@/lib/memory/context", () => ({ buildCampaignContext: vi.fn() }));
vi.mock("@/lib/ai/intent", () => ({ parseIntent: vi.fn() }));
vi.mock("@/lib/ai/narrator", () => ({
  streamNarrative: vi.fn(async () => ({
    textStream: (async function* () { yield "ok"; })(),
  })),
}));

import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { buildCampaignContext } from "@/lib/memory/context";
import { parseIntent } from "@/lib/ai/intent";
import { travelDistanceMiles } from "@/lib/rules/travel";

const prismaTx = {
  campaign: { update: vi.fn() },
  character: { update: vi.fn() },
  gameLog: { create: vi.fn() },
};

const params = Promise.resolve({ id: "camp_1" });

const request = (action: string) =>
  new Request("http://localhost/api/campaign/camp_1/action", {
    method: "POST",
    body: JSON.stringify({ action }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const CHARACTER = {
  id: "char_1",
  name: "Thalindra",
  race: "Elf",
  class: "fighter",
  level: 3,
  hp: 20,
  maxHp: 20,
  xp: 0,
  stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  spellSlots: null,
  skillProficiencies: null,
  concentrationSpellId: null,
  hitDiceTotal: 3,
  hitDiceRemaining: 3,
  exhaustionLevel: 0,
  inventory: [],
};

function primeContext(): void {
  (buildCampaignContext as ReturnType<typeof vi.fn>).mockResolvedValue({
    character: CHARACTER,
    activeEncounter: null,
    recentLogs: [],
    relevantMemories: [],
    quests: [],
    currentExploration: {
      location: { id: "loc_origin", name: "The Sable Crypt", type: "dungeon", description: "" },
      currentNode: null,
      adjacentNodes: [],
      visitedNodeIndices: [],
      allNodes: [],
      allEdges: [],
    },
    gold: 0,
    activeNPC: null,
  });
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user_1",
    status: "active",
    currentLocationId: "loc_origin",
  });
  (prisma.location.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "loc_origin",
    seed: "seed_origin",
  });
  (prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "loc_dest",
    name: "The Gilded Boar",
    seed: "seed_dest",
  });
  (prisma.locationNode.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "node_entry",
  });
}

describe("travel gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeContext();
    prismaTx.campaign.update.mockResolvedValue({});
    prismaTx.character.update.mockResolvedValue({});
    prismaTx.gameLog.create.mockResolvedValue({});
  });

  it("moves the party to the destination's entry node", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: false,
    });

    const res = await POST(request("travel to the Gilded Boar"), { params });

    expect(res.status).toBe(200);
    expect(prismaTx.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { currentLocationId: "loc_dest", currentNodeId: "node_entry" },
    });
  });

  /**
   * Normal travel costs days, never health. A gate that wrote exhaustion
   * regardless would still pass the movement test above.
   */
  it("writes no exhaustion for an ordinary journey", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: false,
    });

    await POST(request("travel to the Gilded Boar"), { params });

    expect(prismaTx.character.update).not.toHaveBeenCalled();
  });

  it("persists the exhaustion a failed forced march resolved", async () => {
    // A natural 1 fails every DC at +0, so every forced hour costs a level.
    vi.spyOn(Math, "random").mockReturnValue(0);
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: true,
    });

    const miles = travelDistanceMiles("seed_origin", "seed_dest");
    const forcedHours = Math.max(0, Math.ceil(miles / 3) - 8);

    await POST(request("travel to the Gilded Boar, forced march"), { params });

    if (forcedHours === 0) {
      expect(prismaTx.character.update).not.toHaveBeenCalled();
    } else {
      expect(prismaTx.character.update).toHaveBeenCalledWith({
        where: { id: "char_1" },
        data: { exhaustionLevel: Math.min(6, forcedHours) },
      });
    }
    vi.restoreAllMocks();
  });

  it("refuses an unknown destination without writing anything", async () => {
    (prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Atlantis",
      forceMarch: false,
    });

    const res = await POST(request("travel to Atlantis"), { params });

    expect(res.status).toBe(400);
    expect(prismaTx.campaign.update).not.toHaveBeenCalled();
    expect(prismaTx.character.update).not.toHaveBeenCalled();
  });

  it("refuses a journey to where the party already stands", async () => {
    (prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "loc_origin",
      name: "The Sable Crypt",
      seed: "seed_origin",
    });
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Sable Crypt",
      forceMarch: false,
    });

    const res = await POST(request("travel to the Sable Crypt"), { params });

    expect(res.status).toBe(400);
    expect(prismaTx.campaign.update).not.toHaveBeenCalled();
  });

  it("writes a system log line carrying the resolved figures", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      actionType: "travel",
      destination: "Gilded Boar",
      forceMarch: false,
    });

    await POST(request("travel to the Gilded Boar"), { params });

    const miles = travelDistanceMiles("seed_origin", "seed_dest");
    expect(prismaTx.gameLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "system",
          content: expect.stringContaining(`${miles} mi`),
        }),
      })
    );
  });
});
```

- [ ] **Step 7: Write the gate**

In `app/api/campaign/[id]/action/route.ts`, add these imports beside the existing rules imports:

```typescript
import { travelDistanceMiles, resolveJourney } from "@/lib/rules/travel";
```

Insert this gate **immediately before** the `move` gate (`if (intent.actionType === "move" && intent.destination) {`):

```typescript
    if (intent.actionType === "travel" && intent.destination) {
      const originId = context.currentExploration?.location?.id ?? null;
      if (!originId) {
        return NextResponse.json(
          { error: "You are nowhere to travel from yet." },
          { status: 400 }
        );
      }

      const destination = await prisma.location.findFirst({
        where: {
          campaignId,
          name: { equals: intent.destination, mode: "insensitive" },
        },
        select: { id: true, name: true, seed: true },
      });

      if (!destination) {
        const known = await prisma.location.findMany({
          where: { campaignId },
          select: { name: true },
        });
        return NextResponse.json(
          {
            error:
              `You know no place called "${intent.destination}". ` +
              `Known: ${known.map((l) => l.name).join(", ") || "nowhere yet"}.`,
          },
          { status: 400 }
        );
      }

      if (destination.id === originId) {
        return NextResponse.json(
          { error: `You are already at ${destination.name}.` },
          { status: 400 }
        );
      }

      const entryNode = await prisma.locationNode.findFirst({
        where: { locationId: destination.id },
        orderBy: { index: "asc" },
        select: { id: true },
      });
      if (!entryNode) {
        return NextResponse.json(
          { error: `${destination.name} has no way in.` },
          { status: 409 }
        );
      }

      const origin = await prisma.location.findUnique({
        where: { id: originId },
        select: { name: true, seed: true },
      });

      // Every figure is resolved here, before anything is written or narrated.
      const stats = (context.character.stats ?? {}) as Partial<Record<string, number>>;
      const journey = resolveJourney({
        distanceMiles: travelDistanceMiles(origin?.seed ?? originId, destination.seed),
        forceMarch: intent.forceMarch === true,
        conModifier: abilityModifier(stats.CON ?? 10),
        currentExhaustion: context.character.exhaustionLevel,
      });

      const logLine = journey.forcedHours > 0
        ? `Travel: ${origin?.name ?? "Unknown"} → ${destination.name}, ` +
          `${journey.distanceMiles} mi forced march, ${journey.hours} h. ` +
          `Forced march: ${journey.forcedHours} h, ` +
          `DC ${journey.saves.map((s) => s.dc).join("/")} → ` +
          `${journey.saves.filter((s) => !s.success).length} failed, ` +
          `exhaustion ${context.character.exhaustionLevel} → ` +
          `${context.character.exhaustionLevel + journey.exhaustionGained}.`
        : `Travel: ${origin?.name ?? "Unknown"} → ${destination.name}, ` +
          `${journey.distanceMiles} mi at normal pace, ${journey.days} day(s).`;

      await prisma.$transaction(async (tx) => {
        if (journey.exhaustionGained > 0) {
          await tx.character.update({
            where: { id: context.character.id },
            data: {
              exhaustionLevel:
                context.character.exhaustionLevel + journey.exhaustionGained,
            },
          });
        }

        await tx.campaign.update({
          where: { id: campaignId },
          data: { currentLocationId: destination.id, currentNodeId: entryNode.id },
        });

        await tx.gameLog.create({
          data: { campaignId, role: "system", content: logLine },
        });
      });
    }

```

`abilityModifier` is already imported by this route at line 55, so the only new import is the one above. `LocationNode` has `locationId` and `index`, which is what the entry-node lookup orders by.

- [ ] **Step 8: Run every affected suite**

Run: `pnpm exec vitest run tests/api/travel-route.test.ts tests/ai/intent.test.ts tests/architecture/intent-gate-exhaustiveness.test.ts --maxWorkers=1`
Expected: PASS. The exhaustiveness guard that went red in Step 5 is green again.

- [ ] **Step 9: Falsify each wire**

| Change | Must kill, and nothing else |
| --- | --- |
| Delete the `if (!destination)` block | "refuses an unknown destination without writing anything" |
| Delete the `destination.id === originId` block | "refuses a journey to where the party already stands" |
| `forceMarch: false` hardcoded in the `resolveJourney` call | "persists the exhaustion a failed forced march resolved" |
| Remove the `tx.gameLog.create` call | "writes a system log line carrying the resolved figures" |
| Remove `"travel"` from the schema enum | the exhaustiveness guard's second assertion |

- [ ] **Step 10: Run the gates and commit**

```bash
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/api/ tests/ai/ tests/architecture/ tests/rules/travel.test.ts --maxWorkers=1
git add lib/ai/intent.ts tests/ai/intent.test.ts "app/api/campaign/[id]/action/route.ts" tests/api/travel-route.test.ts
git commit -m "feat(travel): let the party journey to a location it knows

Adds the travel intent and its gate together, because
intent-gate-exhaustiveness asserts in both directions: every schema action
type except general needs a gate, and no gate may test a type the schema
cannot emit. Either half alone leaves the tree red.

Travel gets its own verbs rather than sharing \"go to\" with move.
Movement inside a location and a journey between them are different
gates, and one wrong guess sends the party days away.

The gate resolves everything before it writes: destination by name within
the campaign, distance from the two seeds, and the journey from the rule.
One transaction then moves the party to the destination's entry node,
raises exhaustion only when a forced march cost some, and writes the
system log line the narrator reads.

This is the first producer Character.exhaustionLevel has ever had. Its
consumer — disadvantage on every ability check — and its reducer — the
long rest — were both already live.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Retire the watches line from the Iron Laws

**Files:**
- Modify: `lib/memory/formatter.ts` — the last line of `formatIronLaws()` (~line 85) and the `WATCHES_PER_DAY` import (~line 24)
- Modify: `tests/memory/formatter.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1 or 2. This task is independent and may be done first if preferred.
- Produces: nothing.

**Why it is in scope.** `formatIronLaws()` reaches the narrator on **every turn** — it is not a conditional section. It currently states `Wilderness day structure is fixed at 6 watches.`, describing a subsystem that cannot run. Under this plan the day is eight hours of marching, so the line stops being merely useless and becomes wrong.

- [ ] **Step 1: Write the failing test**

Add to `tests/memory/formatter.test.ts`:

```typescript
describe("formatIronLaws — no wilderness watches", () => {
  /**
   * The Iron Laws reach the model every turn. This line described the hexcrawl
   * subsystem that the 2026-09-03 decision rejected; under SRD travel a day is
   * eight hours of marching, not six watches, so leaving it would state a rule
   * the engine does not implement.
   */
  it("states no watch structure", () => {
    const laws = formatIronLaws();
    expect(laws).not.toContain("watches");
    expect(laws).not.toContain("Wilderness day structure");
  });

  /** The control: the rest of the Iron Laws must survive. */
  it("keeps the laws that still hold", () => {
    const laws = formatIronLaws();
    expect(laws).toContain("Code is Law / State is Truth");
    expect(laws).toContain("Tooling Protocol");
  });
});
```

`formatIronLaws` must be added to the existing import from `@/lib/memory/formatter` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/memory/formatter.test.ts --maxWorkers=1`
Expected: FAIL on "states no watch structure" — the string `watches` is present.

- [ ] **Step 3: Remove the line and its import**

In `lib/memory/formatter.ts`, delete the final entry of the array returned by `formatIronLaws()`:

```typescript
    `Wilderness day structure is fixed at ${WATCHES_PER_DAY} watches.`,
```

and delete the now-unused import:

```typescript
import { WATCHES_PER_DAY } from "@/lib/rules/wilderness";
```

The preceding line, `"**Continuity:** Keep narration tightly grounded in current state, recent events, and scene context."`, becomes the last element — remove the trailing comma only if the file's style requires it; leaving it is valid TypeScript.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/memory/formatter.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 5: Falsify**

Restore the line without restoring the import (use the literal `"Wilderness day structure is fixed at 6 watches."`) and confirm **only** "states no watch structure" fails. Restore.

- [ ] **Step 6: Run every gate, including the build**

```bash
pnpm typecheck
pnpm lint
pnpm exec vitest run --maxWorkers=1
pnpm build
```

`pnpm lint` matters most here: removing the line orphans the `WATCHES_PER_DAY` import, and that is precisely the failure that broke CI in #115 — typecheck and vitest both pass on an unused import, and `next build` does not.

Expected: the full suite green. Compare the file and test counts against the run before this branch; the difference must equal the tests added by Tasks 1–3 and nothing else.

- [ ] **Step 7: Commit**

```bash
git add lib/memory/formatter.ts tests/memory/formatter.test.ts
git commit -m "refactor(memory): drop the wilderness watches line from the Iron Laws

formatIronLaws reaches the narrator on every turn. Its last line told the
model that a wilderness day is six watches — a hexcrawl structure whose
subsystem cannot run, and which the 2026-09-03 decision rejected. Under
SRD travel a day is eight hours of marching, so the line was about to
stop being merely useless and start being wrong.

The WATCHES_PER_DAY import goes with it. pnpm lint is the gate that
catches that: typecheck and vitest both pass on an unused import, and
next build does not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task:

| Spec section | Task |
| --- | --- |
| §1 the decision; the Iron Laws exception | Task 3 |
| §3 scope — exclusions are absences, nothing implements them | — |
| §4.1 distance, §4.2 duration, §4.4 forced march, exhaustion cap | Task 1 |
| §5 the route gate, no new event | Task 2 |
| §6 the log line | Task 2, Steps 7 and 9 |
| §7 error handling, all four cases | Task 2, Steps 6 and 7 |
| §8 intent | Task 2, Steps 3–4 |
| §9 testing and falsification | every task's test and falsify steps |
| §10 follow-ups | out of scope by design |

**Placeholders.** None: every code step carries the code, every run step carries the command and the expected result, and every falsification names the change and the test that must die.

**Type consistency.** `travelDistanceMiles(seedA, seedB)` and `resolveJourney({ distanceMiles, forceMarch, conModifier, currentExhaustion })` are defined in Task 1 and called with those exact names and shapes in Task 2. `JourneyOutcome.saves[].dc` and `.success` are read in the gate's log line exactly as Task 1 defines them. `forceMarch` is the field name in the intent schema, the parse branch, the route gate and the tests.

**One gap worth stating rather than papering over.** Task 2's forced-march test derives the expected exhaustion from `travelDistanceMiles("seed_origin", "seed_dest")` at test time instead of hardcoding a number, and branches on whether that distance produces any forced hours at all. This keeps the test honest if the distance function is ever retuned, but it means the test can silently exercise the zero-forced-hours path. The implementer must check which branch it took on the first green run, and if it is the zero branch, change the fixture seeds until it is not.
