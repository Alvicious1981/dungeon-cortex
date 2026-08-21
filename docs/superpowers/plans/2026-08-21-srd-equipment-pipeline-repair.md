# SRD Equipment Pipeline Repair — Implementation Plan (PR 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `getEquipmentInfo` return real data by reading the table that
actually holds it (`SrdItem`), with one lookup instead of two.

**Architecture:** A pure projection module owns `EquipmentInfo` and maps raw
dnd5eapi JSON onto it, testable with no mocking. The lookup module owns the
query and re-exports both. The AI tool module keeps its public surface but stops
defining a rival copy. `SrdEquipment` is left with no reader and no writer.

**Tech Stack:** TypeScript, Next.js 15, Prisma 6.19.2, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-21-weapon-proficiency-authority-design.md`

## Global Constraints

- Package manager is **pnpm**. Never `npm`, `yarn` or `bun`. Do not modify
  `pnpm-lock.yaml`; no dependency is added or removed by this plan.
- **No rule changes and no roll changes in this PR.** If a change would alter an
  attack, damage, or any dice outcome, it belongs to PR 2. Stop and report.
- Do not run `prisma migrate`, `db push`, `db seed`, or `db execute`. This plan
  touches no migration and no schema.
- Never read or modify `.env`.
- D&D 5e/SRD 2014 only. Never introduce THAC0, descending AC, AD&D saving throw
  categories, or gold-for-XP.
- Casing from the SRD is **preserved verbatim** by the projector (`"Martial"`,
  `"Versatile"`). Lowercasing belongs to PR 2. `EquipmentInfo` is narrator-facing
  output; changing its casing would be a behaviour change this PR must not make.
- Commit after every task. Do not squash locally; the PR is squashed on merge.
- Test command: `pnpm exec vitest run <path>` for one file, `pnpm test` for all.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/srd-equipment-projection.ts` | **Create.** Owns `EquipmentInfo` and `projectSrdItem`. Pure: no Prisma, no I/O, no throw. |
| `tests/rules/srd-equipment-projection.test.ts` | **Create.** Tests the projector against the real `data/srd-es/equipment.json`. No mocks. |
| `lib/rules/srd-equipment-lookup.ts` | **Modify.** Queries `SrdItem`; re-exports `EquipmentInfo` and `projectSrdItem`. |
| `tests/rules/srd-equipment-lookup.test.ts` | **Create.** Query behaviour with a mocked Prisma client, including the no-fuzzy-match guarantee. |
| `lib/ai/tools/srd-lookup.ts` | **Modify.** Deletes its duplicate `EquipmentInfo` and `getEquipmentInfo`; re-exports the rules module's. |
| `scripts/ingest-srd.ts` | **Modify.** Removes the unreachable `SrdEquipment` ingestion. |
| `tests/architecture/srd-equipment-single-lookup.test.ts` | **Create.** Guard: exactly one equipment query exists, and nothing reads or writes `SrdEquipment`. |

---

### Task 1: The pure projector

**Files:**
- Create: `lib/rules/srd-equipment-projection.ts`
- Test: `tests/rules/srd-equipment-projection.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EquipmentInfo` (interface, 22 fields — exact shape below) and
  `projectSrdItem(name: string, data: unknown): EquipmentInfo`. Tasks 2 and 3
  import both from `@/lib/rules/srd-equipment-projection`.

**Background you need.** `SrdItem.data` is the raw JSON from
`https://www.dnd5eapi.co/api`, seeded from `data/srd-es/equipment.json` by
`prisma/seed-srd.ts`. Despite the `srd-es` directory name the content is
English. The field paths below are not guesses: they are the same paths
`scripts/ingest-srd.ts:610-640` already uses, which this task extracts. What is
new is that every read is type-checked instead of `any`-cast.

Three shapes matter and are easy to get wrong:
- `equipment_category` is an **object** `{index,name,url}` in all 237 rows, not
  a string. Take `.name`.
- `desc` is an **array** of strings in all 109 rows that have it. Join with
  `"\n"`, matching `ingest-srd.ts:606`.
- `damage` is **absent on one weapon**, `Net`. `damageDice` is nullable.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/srd-equipment-projection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectSrdItem } from "@/lib/rules/srd-equipment-projection";

/**
 * The projector is tested against the real file the seeder reads, not against
 * hand-written objects. Five test files mock `srdEquipment` and hand back
 * fabricated rows; that is how an empty table stayed invisible to 2995 tests.
 * A fixture written by hand would repeat the mistake in a new place.
 */
const RAW = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "equipment.json"), "utf8"),
) as Array<Record<string, unknown>>;

function entry(name: string): Record<string, unknown> {
  const found = RAW.find((item) => item.name === name);
  if (!found) throw new Error(`Fixture drift: "${name}" is not in equipment.json`);
  return found;
}

describe("projectSrdItem", () => {
  it("projects a martial melee weapon in full", () => {
    expect(projectSrdItem("Longsword", entry("Longsword"))).toEqual({
      name: "Longsword",
      equipmentCategory: "Weapon",
      weaponCategory: "Martial",
      weaponRange: "Melee",
      categoryRange: "Martial Melee",
      costQuantity: 15,
      costUnit: "gp",
      weight: 3,
      damageDice: "1d8",
      damageType: "Slashing",
      twoHandedDamageDice: "1d10",
      twoHandedDamageType: "Slashing",
      rangeNormal: 5,
      rangeLong: null,
      armorCategory: null,
      armorClassBase: null,
      armorClassDexBonus: null,
      armorClassMaxBonus: null,
      strMinimum: null,
      stealthDisadvantage: null,
      desc: null,
      properties: ["Versatile"],
    });
  });

  it("projects the one weapon that has no damage object", () => {
    const net = projectSrdItem("Net", entry("Net"));
    expect(net.damageDice).toBeNull();
    expect(net.damageType).toBeNull();
    expect(net.weaponCategory).toBe("Martial");
    expect(net.weaponRange).toBe("Ranged");
    expect(net.rangeNormal).toBe(5);
    expect(net.rangeLong).toBe(15);
    expect(net.properties).toEqual(["Thrown", "Special"]);
  });

  it("projects armour", () => {
    const armour = projectSrdItem("Half Plate Armor", entry("Half Plate Armor"));
    expect(armour.equipmentCategory).toBe("Armor");
    expect(armour.armorCategory).toBe("Medium");
    expect(armour.armorClassBase).toBe(15);
    expect(armour.armorClassDexBonus).toBe(true);
    expect(armour.armorClassMaxBonus).toBe(2);
    expect(armour.strMinimum).toBe(0);
    expect(armour.stealthDisadvantage).toBe(true);
    expect(armour.weaponCategory).toBeNull();
    expect(armour.properties).toEqual([]);
  });

  it("preserves SRD casing rather than normalising it", () => {
    // Lowercasing here would change what the narrator's equipment tool returns.
    // Normalisation belongs to the rule layer in PR 2.
    expect(projectSrdItem("Longsword", entry("Longsword")).weaponCategory).toBe("Martial");
    expect(projectSrdItem("Rapier", entry("Rapier")).properties).toContain("Finesse");
  });

  it("degrades to nulls instead of throwing on an unexpected shape", () => {
    for (const bad of [null, undefined, 42, "text", [], {}]) {
      const projected = projectSrdItem("Fireball", bad);
      expect(projected.name).toBe("Fireball");
      expect(projected.weaponCategory).toBeNull();
      expect(projected.damageDice).toBeNull();
      expect(projected.properties).toEqual([]);
    }
  });

  // ─── Whole-file sweep ──────────────────────────────────────────────────────
  // A named case proves that one row projects. Only the sweep can say the other
  // 236 do. Absence is proved by construction here, never by sampling.
  describe("across every row in equipment.json", () => {
    it("projects all 237 rows without throwing", () => {
      expect(RAW.length).toBe(237);
      for (const item of RAW) {
        expect(() => projectSrdItem(String(item.name), item)).not.toThrow();
      }
    });

    it("resolves a category for every weapon and only for weapons", () => {
      const weapons = RAW.filter((item) => item.weapon_category !== undefined);
      expect(weapons.length).toBe(37);

      for (const item of RAW) {
        const projected = projectSrdItem(String(item.name), item);
        if (item.weapon_category === undefined) {
          expect(projected.weaponCategory).toBeNull();
        } else {
          expect(["Simple", "Martial"]).toContain(projected.weaponCategory);
        }
      }
    });

    it("finds exactly one weapon with no damage dice, and it is the Net", () => {
      const undamaged = RAW
        .filter((item) => item.weapon_category !== undefined)
        .map((item) => projectSrdItem(String(item.name), item))
        .filter((projected) => projected.damageDice === null);

      expect(undamaged.map((projected) => projected.name)).toEqual(["Net"]);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/srd-equipment-projection.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/rules/srd-equipment-projection"`.

- [ ] **Step 3: Write the implementation**

Create `lib/rules/srd-equipment-projection.ts`:

```ts
/**
 * lib/rules/srd-equipment-projection.ts
 *
 * Maps a raw SRD equipment row onto the typed shape the rest of the app uses.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * `SrdItem.data` is the unmodified JSON from https://www.dnd5eapi.co/api. The
 * field paths here are the ones scripts/ingest-srd.ts already used; what is new
 * is that each read is checked rather than cast. A cast is how a wrong shape
 * reaches a rule unnoticed, which is the defect this module exists to close.
 *
 * Casing is preserved exactly as the SRD writes it. EquipmentInfo is returned to
 * the AI narrator through its equipment tool, so normalising here would change
 * narrator-facing output. The rule layer lowercases at the point it needs to.
 */

export interface EquipmentInfo {
  name: string;
  equipmentCategory: string | null;
  weaponCategory: string | null;
  weaponRange: string | null;
  categoryRange: string | null;
  costQuantity: number | null;
  costUnit: string | null;
  weight: number | null;
  damageDice: string | null;
  damageType: string | null;
  twoHandedDamageDice: string | null;
  twoHandedDamageType: string | null;
  rangeNormal: number | null;
  rangeLong: number | null;
  armorCategory: string | null;
  armorClassBase: number | null;
  armorClassDexBonus: boolean | null;
  armorClassMaxBonus: number | null;
  strMinimum: number | null;
  stealthDisadvantage: boolean | null;
  desc: string | null;
  properties: string[];
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function child(parent: JsonRecord | null, key: string): JsonRecord | null {
  return parent === null ? null : asRecord(parent[key]);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** `desc` is an array of paragraphs in every row that has one. */
function joinDesc(value: unknown): string | null {
  if (!Array.isArray(value)) return str(value);
  const paragraphs = value.filter((part): part is string => typeof part === "string");
  return paragraphs.length > 0 ? paragraphs.join("\n") : null;
}

/** `properties` is an array of `{index,name,url}` objects, or absent. */
function propertyNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((part) => str(asRecord(part)?.name))
    .filter((name): name is string => name !== null);
}

/**
 * Projects one SRD equipment row.
 *
 * `name` comes from the row's own column rather than the blob, so a row whose
 * JSON is malformed still answers with its identity. Every other field is
 * individually nullable, and an unusable shape yields null rather than an
 * exception — a bad row must degrade the narrator's answer, not break its tool.
 */
export function projectSrdItem(name: string, data: unknown): EquipmentInfo {
  const root = asRecord(data);
  const cost = child(root, "cost");
  const damage = child(root, "damage");
  const twoHanded = child(root, "two_handed_damage");
  const range = child(root, "range");
  const armorClass = child(root, "armor_class");

  return {
    name,
    equipmentCategory: str(child(root, "equipment_category")?.name),
    weaponCategory: str(root?.weapon_category),
    weaponRange: str(root?.weapon_range),
    categoryRange: str(root?.category_range),
    costQuantity: num(cost?.quantity),
    costUnit: str(cost?.unit),
    weight: num(root?.weight),
    damageDice: str(damage?.damage_dice),
    damageType: str(child(damage, "damage_type")?.name),
    twoHandedDamageDice: str(twoHanded?.damage_dice),
    twoHandedDamageType: str(child(twoHanded, "damage_type")?.name),
    rangeNormal: num(range?.normal),
    rangeLong: num(range?.long),
    armorCategory: str(root?.armor_category),
    armorClassBase: num(armorClass?.base),
    armorClassDexBonus: bool(armorClass?.dex_bonus),
    armorClassMaxBonus: num(armorClass?.max_bonus),
    strMinimum: num(root?.str_minimum),
    stealthDisadvantage: bool(root?.stealth_disadvantage),
    desc: joinDesc(root?.desc),
    properties: propertyNames(root?.properties),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/srd-equipment-projection.test.ts
```

Expected: PASS, 8 tests.

If the whole-file sweep fails on the count `237` or `37`, **do not edit the
expected number to match**. The counts were measured against the live database
and the file together; a mismatch means the file changed, and that is a finding
to report, not a test to adjust.

- [ ] **Step 5: Commit**

```bash
git add lib/rules/srd-equipment-projection.ts tests/rules/srd-equipment-projection.test.ts
git commit -m "feat(srd): project a raw SRD equipment row onto a checked shape"
```

---

### Task 2: Point the lookup at the table with the data

**Files:**
- Modify: `lib/rules/srd-equipment-lookup.ts` (replace the whole file)
- Test: `tests/rules/srd-equipment-lookup.test.ts` (create)

**Interfaces:**
- Consumes: `EquipmentInfo`, `projectSrdItem` from
  `@/lib/rules/srd-equipment-projection` (Task 1).
- Produces: `getEquipmentInfo(query: string): Promise<EquipmentInfo | null>`,
  plus re-exports of `EquipmentInfo` and `projectSrdItem`. Task 3 imports
  `getEquipmentInfo` and the `EquipmentInfo` type from this module's path.

**Background you need.** Today this module queries `prisma.srdEquipment`, which
has zero rows, so it returns `null` for every weapon and every piece of armour.
The data is in `prisma.srdItem` (237 rows).

The old name fallback used `contains` with `take: 5` and then accepted
`candidates[0]` when no exact match was found. That means asking for `"Sword"`
returns a Longsword. A rules authority must not decide by resemblance, so the
new lookup matches on **equality** only.

Keep using `findMany` rather than `findFirst`. Four existing test files mock the
Prisma client with only `findUnique` and `findMany`; switching to `findFirst`
would make those mocks return `undefined` and crash tests that this PR has no
business touching.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/srd-equipment-lookup.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { srdItem: { findUnique, findMany } },
}));

import { getEquipmentInfo } from "@/lib/rules/srd-equipment-lookup";

const LONGSWORD_ROW = {
  id: "longsword",
  name: "Longsword",
  data: {
    name: "Longsword",
    weapon_category: "Martial",
    weapon_range: "Melee",
    damage: { damage_dice: "1d8", damage_type: { name: "Slashing" } },
  },
};

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset();
  findUnique.mockResolvedValue(null);
  findMany.mockResolvedValue([]);
});

describe("getEquipmentInfo", () => {
  it("resolves by exact id", async () => {
    findUnique.mockResolvedValue(LONGSWORD_ROW);

    const result = await getEquipmentInfo("longsword");

    expect(result?.name).toBe("Longsword");
    expect(result?.weaponCategory).toBe("Martial");
    expect(result?.damageDice).toBe("1d8");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("falls back to an exact name match, ignoring case and padding", async () => {
    findMany.mockResolvedValue([LONGSWORD_ROW]);

    const result = await getEquipmentInfo("  LONGSWORD ");

    expect(result?.weaponCategory).toBe("Martial");
  });

  it("returns null rather than the nearest name", async () => {
    // The database would answer an equality query for "Sword" with nothing.
    // This asserts the module does not then settle for a near miss.
    findMany.mockResolvedValue([]);

    expect(await getEquipmentInfo("Sword")).toBeNull();
  });

  it("never asks the database for a substring match", async () => {
    await getEquipmentInfo("Sword");

    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.name).toHaveProperty("equals");
    expect(where.name).not.toHaveProperty("contains");
  });

  it("discards a row the database returns that is not an exact match", async () => {
    // Belt and braces: even if the query were loosened by a later edit, the
    // module itself must still refuse a row whose name is not the one asked for.
    findMany.mockResolvedValue([LONGSWORD_ROW]);

    expect(await getEquipmentInfo("Sword")).toBeNull();
  });

  it("reads SrdItem, which holds the data, and never SrdEquipment", async () => {
    findUnique.mockResolvedValue(LONGSWORD_ROW);
    await getEquipmentInfo("longsword");

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "longsword" } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/srd-equipment-lookup.test.ts
```

Expected: FAIL. The mock only defines `prisma.srdItem`, so the current
implementation throws `Cannot read properties of undefined (reading
'findUnique')` on `prisma.srdEquipment`.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `lib/rules/srd-equipment-lookup.ts` with:

```ts
/**
 * lib/rules/srd-equipment-lookup.ts
 *
 * Looks one SRD equipment row up and returns it in a typed shape.
 *
 * This module used to query `SrdEquipment`, a table nothing has ever written to,
 * so it answered null for every weapon and every piece of armour in the game.
 * The seeded data lives in `SrdItem`.
 *
 * Matching is by id or by exact name. The previous implementation fell back to a
 * substring search and accepted the first of five candidates, which made
 * "Sword" resolve to a Longsword — a rules authority deciding by resemblance.
 *
 * Server-only — never import from a client component.
 */

import { prisma } from "@/lib/db/prisma";
import {
  projectSrdItem,
  type EquipmentInfo,
} from "@/lib/rules/srd-equipment-projection";

export { projectSrdItem };
export type { EquipmentInfo };

export async function getEquipmentInfo(query: string): Promise<EquipmentInfo | null> {
  const byId = await prisma.srdItem.findUnique({ where: { id: query } });
  if (byId) return projectSrdItem(byId.name, byId.data);

  const wanted = query.trim().toLowerCase();
  if (wanted.length === 0) return null;

  // findMany rather than findFirst: several existing test suites mock the Prisma
  // client with findUnique and findMany only, and this module has no reason to
  // break them. take: 2 is enough to answer "is there exactly one?".
  const candidates = await prisma.srdItem.findMany({
    where: { name: { equals: wanted, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: 2,
  });

  // The equality filter should already guarantee this. Re-checking in code means
  // a later loosening of the query cannot silently reintroduce a fuzzy match.
  const exact = candidates.find(
    (candidate) => candidate.name.trim().toLowerCase() === wanted,
  );

  return exact ? projectSrdItem(exact.name, exact.data) : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/srd-equipment-lookup.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Check nothing else broke**

```bash
pnpm exec vitest run tests/ai
```

Expected: PASS. These suites mock every SRD table onto one shared row, so
`getEquipmentInfo` now reads `srdItem` from the same mock and projects a row
whose `data` is `{ name: "Fireball" }`. The projector must yield nulls without
throwing — Task 1 Step 1 covers exactly this case. If anything fails here,
report it rather than loosening the projector.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/srd-equipment-lookup.ts tests/rules/srd-equipment-lookup.test.ts
git commit -m "fix(srd): read equipment from the table that has the rows"
```

---

### Task 3: One lookup, and a guard that keeps it one

**Files:**
- Modify: `lib/ai/tools/srd-lookup.ts:181-250` (delete the interface and the function, add re-exports)
- Modify: `scripts/ingest-srd.ts` (remove the equipment ingestion)
- Test: `tests/architecture/srd-equipment-single-lookup.test.ts` (create)

**Interfaces:**
- Consumes: `getEquipmentInfo` and `EquipmentInfo` from
  `@/lib/rules/srd-equipment-lookup` (Task 2).
- Produces: no new symbols. `lib/ai/tools/srd-lookup.ts` keeps exporting the
  same names, so `lib/ai/read-only-projections.ts:4` — which imports the
  `EquipmentInfo` **type** from it — needs no edit.

**Background you need.** `lib/ai/tools/srd-lookup.ts:181-250` contains a
character-for-character duplicate of the interface (line 183) and the query
(line 208). The block ends immediately before the
`// ─── Tool definitions ───` banner at line 252. The defect
existed in two places at once because the code did. Fixing one and leaving the
other would reinstate it in the layer that feeds the narrator.

That file's own header already claims it queries "`SrdMonster`, `SrdSpell`, and
`SrdItem`". After this task the claim is true.

`scripts/ingest-srd.ts` is the only remaining writer of `SrdEquipment`. It is
absent from `package.json`, reads the same `data/srd-es/equipment.json` the
seeder reads into `SrdItem`, and has never run against this database. Removing
its equipment section leaves `SrdEquipment` with no reader and no writer —
unambiguously dead, awaiting its own decision. **Do not drop the Prisma model
and do not write a migration.**

- [ ] **Step 1: Write the failing guard**

Create `tests/architecture/srd-equipment-single-lookup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The equipment lookup existed twice, so the defect existed twice. A test is
 * what stops it coming back as a third copy.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") || name.endsWith(".tsx") ? [path] : [];
  });
}

const ROOTS = ["lib", "app", "components", "scripts", "prisma"].map((dir) =>
  join(process.cwd(), dir),
);
const SOURCES = ROOTS.flatMap(sourceFiles);

describe("SRD equipment lookup architecture", () => {
  it("defines the equipment query in exactly one module", () => {
    const definers = SOURCES.filter((path) =>
      /export\s+async\s+function\s+getEquipmentInfo\s*\(/.test(
        readFileSync(path, "utf8"),
      ),
    ).map((path) => path.replace(process.cwd(), "").replace(/\\/g, "/"));

    expect(definers).toEqual(["/lib/rules/srd-equipment-lookup.ts"]);
  });

  it("has no source that reads or writes the empty SrdEquipment table", () => {
    const users = SOURCES.filter((path) =>
      /\bprisma\.srdEquipment\b/.test(readFileSync(path, "utf8")),
    ).map((path) => path.replace(process.cwd(), "").replace(/\\/g, "/"));

    expect(users).toEqual([]);
  });

  it("keeps the AI tool module's equipment surface without redefining it", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "ai", "tools", "srd-lookup.ts"),
      "utf8",
    );

    expect(source).toContain("getEquipmentInfo");
    expect(source).toMatch(
      /from\s+["']@\/lib\/rules\/srd-equipment-lookup["']/,
    );
  });
});
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
pnpm exec vitest run tests/architecture/srd-equipment-single-lookup.test.ts
```

Expected: FAIL on the first two tests — `getEquipmentInfo` is defined in two
files, and three files still reference `prisma.srdEquipment`.

- [ ] **Step 3: Delete the duplicate from the AI tool module**

In `lib/ai/tools/srd-lookup.ts`, delete the whole block from the
`// ─── Equipment lookup ───` comment through the closing brace of
`getEquipmentInfo` — that is the `export interface EquipmentInfo { … }` and the
`export async function getEquipmentInfo(query: string) { … }` immediately after
it. Replace the deleted block with:

```ts
// ─── Equipment lookup ─────────────────────────────────────────────────────────

/**
 * Re-exported from the rules layer, which owns the query.
 *
 * This module used to carry an identical copy reading the empty `SrdEquipment`
 * table. Two copies is why the defect had to be found twice.
 */
export { getEquipmentInfo } from "@/lib/rules/srd-equipment-lookup";
export type { EquipmentInfo } from "@/lib/rules/srd-equipment-lookup";
```

Leave every other export in the file untouched, including `buildSrdTools`, which
already calls `getEquipmentInfo` and now reaches the re-exported one.

- [ ] **Step 4: Remove the unreachable equipment ingestion**

In `scripts/ingest-srd.ts`, delete the function that contains the
`prisma.srdEquipment.upsert` call at line 639 — the one that begins by reading
`../data/srd-es/equipment.json` at line 579 — and delete the call to it inside
`main()`. Leave the monster and spell ingestion completely alone.

Then update the file's header comment, which describes what it ingests, so it no
longer mentions equipment.

Verify no reference survives:

```bash
grep -rn "srdEquipment" scripts/ lib/ app/ components/ prisma/
```

Expected: no output.

- [ ] **Step 5: Run the guard to verify it passes**

```bash
pnpm exec vitest run tests/architecture/srd-equipment-single-lookup.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Drop the dead mock entries**

Four test files still mock a table nothing reads:
`tests/ai/narrator.test.ts`, `tests/ai/narrator-active-tools.test.ts`,
`tests/ai/narrator-real-sdk-containment.test.ts`,
`tests/ai/tools/tool-result-contract.test.ts`.

In each, remove the `srdEquipment: { … }` line from the Prisma mock object. In
`tests/ai/narrator.test.ts` also remove the now-meaningless assertion
`expect(prisma.srdEquipment.findUnique).not.toHaveBeenCalled();` — the line
directly above it already asserts the same thing about `srdItem`, which is the
table actually read.

Do not remove any other assertion.

```bash
pnpm exec vitest run tests/ai
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/tools/srd-lookup.ts scripts/ingest-srd.ts tests/ai tests/architecture/srd-equipment-single-lookup.test.ts
git commit -m "refactor(srd): keep one equipment lookup, and retire the dead table"
```

---

### Task 4: Full verification and pull request

**Files:** none modified. This task only runs checks and opens the PR.

**Interfaces:**
- Consumes: the finished state of Tasks 1-3.
- Produces: a pull request against `master`.

- [ ] **Step 1: Run the full suite**

```bash
pnpm test
```

Expected: PASS. The baseline before this PR is **2995 tests in 148 files**. This
plan adds 3 files and 17 tests, and removes none, so expect **3012 in 151**.

A different total is not automatically wrong, but it must be explained before
proceeding. A *lower* count means something was deleted that this plan did not
intend to delete — stop and report.

- [ ] **Step 2: Run the remaining gates**

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm check-retro
```

```bash
pnpm build
```

Expected: all four clean, exit 0.

- [ ] **Step 3: Confirm the behavioural claim of this PR**

The claim is "no rule changes, no roll changes". Verify it from the diff, not
from memory:

```bash
git diff master --stat
```

Expected: no file under `lib/rules/combat.ts`, `lib/rules/proficiency.ts`,
`lib/character-sheet/`, or `app/api/campaign/` appears. If any does, the PR has
drifted into PR 2's territory — stop and report.

- [ ] **Step 4: Push and open the pull request**

```bash
git push -u origin feat/weapon-proficiency-authority
```

Open the PR against `master` with a body that states: the empty-table defect and
its two-lookup shape, the correction that `scripts/ingest-srd.ts` was the
unreachable writer, why the projector preserves casing, the test counts before
and after, and that PR 2 carries the attack rule.

- [ ] **Step 5: Report completion**

Report files created and modified, commands run with their results, the test
count before and after, and anything that surprised you — especially any place
where the real data disagreed with this plan.

---

## Notes for the reviewer

- **The riskiest change is the narrower name match.** Anything that relied on
  `getEquipmentInfo` finding an item by substring will now get `null`. Nothing
  does today, because it found nothing at all; but it is where to look first if
  the narrator starts answering "I don't know" about a real item.
- **`addItem` in `lib/rules/inventory.ts` is untouched and still broken** in a
  second way: it branches on `info.weaponCategory` to decide an item is a
  weapon, which now works, but it has no callers. PR 2 addresses it.
- **`SrdEquipment` still exists as a Prisma model** with no reader and no
  writer. Dropping it is a destructive migration and deliberately not in scope.
