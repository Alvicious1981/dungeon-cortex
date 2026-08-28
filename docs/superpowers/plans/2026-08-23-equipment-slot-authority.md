# Equipment Slot Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One pure rule decides which slot an item occupies, both writers consume it, and armour becomes obtainable so the proficiency rule shipped last increment can actually fire.

**Architecture:** A new pure module `lib/rules/equipment-slot.ts` exports `slotFor` (the decision) and `slotAccepts` (the judgement, derived from the decision so the two cannot disagree). The action route stops deciding slots inline and consumes `slotFor`; `equipItem` stops accepting any string and refuses placements `slotAccepts` rejects. Two loot rows gain the armour category their fiction already claims, which is what makes `selectBodyArmor` able to return a profile for the first time.

**Tech Stack:** TypeScript, Next.js 15 App Router, Prisma 6.19.2, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-23-equipment-slot-authority-design.md` — read it first, including the section titled "Correction: no production path can create body armour today", which is why Task 4 exists.

## Global Constraints

- **Never run** `prisma migrate`, `prisma db push`, `prisma db seed`, or `prisma db execute`. This plan requires no schema change: `equippedSlot` is already `String?` at `prisma/schema.prisma:292`, and `OFF_HAND` is already a member of `EQUIPMENT_SLOTS`.
- **Never read or edit** `.env` or any secrets file.
- **The database holds a real save.** Read-only access only, and only via the Supabase MCP if it is authenticated. No task in this plan requires database access.
- **Backend code owns mechanical truth.** No slot decision may be made by, or delegated to, the AI layer.
- **Run the suite as** `pnpm exec vitest run --maxWorkers=2`. Plain `pnpm test` produces worker-startup timeouts on this machine that look like test failures.
- `lib/rules/equipment-slot.ts` must be `@pure`: no database, no I/O, no randomness, and it must never throw.
- Do not add a category to any loot row beyond the two named in Task 4. Eight of the ten armour-typed loot rows are worn accessories; giving them a category would route them to `ARMOR` and restore the eviction bug this plan removes.

---

## A correction to carry into Task 4

The scope selected for this plan was previewed as "10 filas ganan armorClass". **The correct number is two.** Of the ten `type: "armor"` rows in `data/loot-tables.json`, eight are gloves, slippers, boots, a helm, a gauntlet, a cloak, a shroud and a mantle — accessories in the fiction as well as in the data, and they must stay categoryless so the slot rule routes them to `ACCESSORY`. Only `Tomb Warden's Cuirass` (a breastplate) and `Ironwood Shield Fragment` (a buckler) are armour, and only they gain a category.

Giving all ten a category would put ten items back in the single `ARMOR` slot and reintroduce, through the data, exactly the defect Tasks 1–3 remove through the code.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/equipment-slot.ts` *(create)* | The only place that decides an item's slot or judges a placement. Pure. |
| `tests/rules/equipment-slot.test.ts` *(create)* | Unit behaviour plus the binding to the real `data/loot-tables.json`. |
| `lib/rules/inventory.ts` *(modify, ~152-172)* | `equipItem` gains a refusal for illegal placements. |
| `lib/rules/equipment-service.ts` *(modify, ~4-7, ~162)* | New error code; maps the refusal onto the existing error path. |
| `app/api/campaign/[id]/action/route.ts` *(modify, 939-941)* | Consumes `slotFor` instead of deciding inline. |
| `data/loot-tables.json` *(modify, 2 rows)* | The Cuirass and the Shield Fragment gain the category their fiction claims. |
| `tests/rules/armor-obtainable.test.ts` *(create)* | Proves the armour stack can now fire, from the real data file. |

---

### Task 1: The slot rule

**Files:**
- Create: `lib/rules/equipment-slot.ts`
- Create: `tests/rules/equipment-slot.test.ts`

**Interfaces:**
- Consumes: `readArmorProfile` from `lib/rules/armor-class.ts` — signature `readArmorProfile(properties: unknown): ArmorProfile`, where `ArmorProfile.category` is `"light" | "medium" | "heavy" | "shield" | null`. Also `EQUIPMENT_SLOTS` from `lib/rules/inventory.ts:393`.
- Produces: `EquipmentSlot`, `SlotDecision`, `slotFor(item: SlotCandidate): SlotDecision`, `slotAccepts(item: SlotCandidate, slot: string): boolean`, and `SlotCandidate` — all consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/equipment-slot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slotAccepts, slotFor } from "@/lib/rules/equipment-slot";
import { EQUIPMENT_SLOTS } from "@/lib/rules/inventory";

/**
 * Bound to the real loot file, not to hand-written objects. Four test files
 * once mocked `srdEquipment` and handed back fabricated rows; that is how an
 * empty table stayed invisible to 2995 tests. A fixture written by hand would
 * repeat the mistake in a new place.
 */
const LOOT = JSON.parse(
  readFileSync(join(process.cwd(), "data", "loot-tables.json"), "utf8"),
) as Record<string, Array<Record<string, unknown>>>;

function lootRows(): Array<Record<string, unknown>> {
  return Object.values(LOOT)
    .filter(Array.isArray)
    .flat() as Array<Record<string, unknown>>;
}

describe("slotFor", () => {
  it("sends a weapon to the main hand", () => {
    expect(slotFor({ type: "weapon", properties: { damageDice: "1d8" } })).toEqual({
      slot: "MAIN_HAND",
      reason: "weapon",
    });
  });

  it("sends each body-armour category to the armour slot", () => {
    for (const category of ["light", "medium", "heavy"] as const) {
      expect(
        slotFor({ type: "armor", properties: { baseAC: 14, armorClass: category } }),
      ).toEqual({ slot: "ARMOR", reason: "body-armour" });
    }
  });

  it("sends a shield to the off hand", () => {
    expect(
      slotFor({ type: "armor", properties: { baseAC: 2, armorClass: "shield" } }),
    ).toEqual({ slot: "OFF_HAND", reason: "shield" });
  });

  it("sends an armour-typed row with no category to the accessory slot", () => {
    expect(slotFor({ type: "armor", properties: { ac_bonus: 1 } })).toEqual({
      slot: "ACCESSORY",
      reason: "accessory",
    });
  });

  it("sends every other type to the accessory slot", () => {
    for (const type of ["consumable", "spell", "misc", "", "ARMOR"]) {
      expect(slotFor({ type, properties: {} }).slot).toBe("ACCESSORY");
    }
  });

  it("never throws on a malformed properties blob", () => {
    for (const properties of [null, undefined, 42, "heavy", [], { armorClass: 7 }]) {
      expect(slotFor({ type: "armor", properties }).slot).toBe("ACCESSORY");
    }
  });
});

describe("slotAccepts", () => {
  it("accepts exactly the slot the rule would choose", () => {
    const item = { type: "armor", properties: { baseAC: 14, armorClass: "medium" } };
    expect(slotAccepts(item, "ARMOR")).toBe(true);
    for (const slot of EQUIPMENT_SLOTS.filter((s) => s !== "ARMOR")) {
      expect(slotAccepts(item, slot)).toBe(false);
    }
  });

  it("rejects a slot that is not a slot at all", () => {
    expect(slotAccepts({ type: "weapon", properties: {} }, "HEAD")).toBe(false);
    expect(slotAccepts({ type: "weapon", properties: {} }, "")).toBe(false);
    expect(slotAccepts({ type: "weapon", properties: {} }, "main_hand")).toBe(false);
  });

  it("agrees with slotFor for every real loot row", () => {
    for (const row of lootRows()) {
      const item = { type: String(row.type), properties: row.properties };
      expect(slotAccepts(item, slotFor(item).slot)).toBe(true);
    }
  });
});

describe("the real loot file", () => {
  it("has ten armour-typed rows", () => {
    expect(lootRows().filter((row) => row.type === "armor")).toHaveLength(10);
  });

  it("routes no loot row to the armour slot while none carries a category", () => {
    const toArmor = lootRows()
      .filter((row) => row.type === "armor")
      .filter(
        (row) =>
          slotFor({ type: "armor", properties: row.properties }).slot === "ARMOR",
      )
      .map((row) => row.name);

    expect(toArmor).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/equipment-slot.test.ts --maxWorkers=2
```

Expected: FAIL — `Failed to resolve import "@/lib/rules/equipment-slot"`.

- [ ] **Step 3: Write the implementation**

Create `lib/rules/equipment-slot.ts`:

```ts
/**
 * lib/rules/equipment-slot.ts
 *
 * Which slot an item occupies, and whether a proposed placement is legal.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * This module exists because the answer was decided in one place and validated
 * in none. `app/api/campaign/[id]/action/route.ts` chose a slot from the item's
 * `type` alone, sending every armour-typed row to the single ARMOR slot — so a
 * pair of boots evicted the body armour and switched off the proficiency rule
 * that decides attack rolls, STR and DEX checks, and whether a caster can cast.
 * `equipItem` took the slot as a parameter and validated nothing at all, not
 * even that the string was a slot.
 *
 * `slotAccepts` is derived from `slotFor` rather than written beside it. A
 * placement is legal exactly when it is the placement the rule would choose,
 * which makes "the rule chose ARMOR but rejects ARMOR" unrepresentable.
 *
 * Routing keys off the armour category, read through `readArmorProfile` — the
 * same reader `selectBodyArmor` uses. If the two read the category differently,
 * an item could occupy ARMOR and still not be found there.
 */

import { readArmorProfile } from "@/lib/rules/armor-class";
// `import type` deliberately: Task 2 makes `inventory.ts` import this module,
// and a value import here would close the cycle at runtime. A type-only import
// is erased, so `EQUIPMENT_SLOTS` stays the single definition of the vocabulary
// without either module depending on the other's evaluation order.
import type { EQUIPMENT_SLOTS } from "@/lib/rules/inventory";

export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Why an item landed in its slot — for the refusal message and the log. */
export type SlotReason = "weapon" | "body-armour" | "shield" | "accessory";

export interface SlotDecision {
  slot: EquipmentSlot;
  reason: SlotReason;
}

/**
 * The least an item must be for the rule to place it.
 *
 * `properties` is `unknown` because it arrives as untyped JSON from Postgres.
 * A blob the reader cannot parse resolves to ACCESSORY — the slot that grants
 * nothing, so a malformed row can never be routed into the one slot that would
 * disable a rule.
 */
export interface SlotCandidate {
  type: string;
  properties: unknown;
}

const ACCESSORY: SlotDecision = { slot: "ACCESSORY", reason: "accessory" };

export function slotFor(item: SlotCandidate): SlotDecision {
  if (item.type === "weapon") return { slot: "MAIN_HAND", reason: "weapon" };

  if (item.type === "armor") {
    const { category } = readArmorProfile(item.properties);

    switch (category) {
      case "light":
      case "medium":
      case "heavy":
        return { slot: "ARMOR", reason: "body-armour" };
      case "shield":
        return { slot: "OFF_HAND", reason: "shield" };
      case null:
        // An armour-typed row that declares no category is a worn bonus, not
        // body armour. Eight of the ten loot rows are exactly this.
        return ACCESSORY;
    }
  }

  return ACCESSORY;
}

/**
 * Whether `item` may occupy `slot`.
 *
 * Note that this rejects a slot the rule would not choose even when that slot
 * is a real member of `EQUIPMENT_SLOTS` — a longsword may not go in ARMOR, and
 * body armour may not go in OFF_HAND.
 */
export function slotAccepts(item: SlotCandidate, slot: string): boolean {
  return slotFor(item).slot === slot;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/equipment-slot.test.ts --maxWorkers=2
```

Expected: PASS, all cases.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors. If TypeScript reports that the `switch` on `category` is not exhaustive, do not add a `default` — add the missing category case, so that adding a fifth `ArmorCategory` later is a compile error here rather than a silent fall-through to ACCESSORY.

- [ ] **Step 6: Commit**

```bash
git add lib/rules/equipment-slot.ts tests/rules/equipment-slot.test.ts
git commit -m "feat(equipment): decide an item's slot in one pure rule"
```

---

### Task 2: `equipItem` refuses an illegal placement

**Files:**
- Modify: `lib/rules/inventory.ts:152-172`
- Modify: `lib/rules/equipment-service.ts:4-7` and `:162`
- Test: `tests/rules/inventory.test.ts` (append), `tests/rules/equipment-service-contract.test.ts` (append)

**Interfaces:**
- Consumes: `slotAccepts(item: SlotCandidate, slot: string): boolean` and `slotFor(item: SlotCandidate): SlotDecision` from Task 1.
- Produces: `equipItem` now throws `RangeError` for an illegal placement as well as an unknown item; `EquipmentServiceErrorCode` gains the member `"ILLEGAL_SLOT_FOR_ITEM"`.

**Why this task exists:** `equipItem`'s only caller is `equipCharacterItem`, whose only caller is the `manageEquipment` AI tool — which `lib/ai/tool-policy.ts` currently keeps off the narrator allowlist. That file states the reduction is *"TEMPORARY, REVERSIBLE — until SEC-AI-001 PR 3 restores them"*. The door is scheduled to open; this closes it before it does. Do not restore `manageEquipment` to the allowlist — that is PR 3's decision, not this plan's.

**Expect 15 existing failures, and do not route around them.** `tests/rules/equipment-service-contract.test.ts` drives the service with `targetSlot: "mainHand"` — camelCase — in 15 places. That string appears in **no** production file: searched for `mainHand` and `offHand` across `lib/`, `app/` and `components/`, zero hits. The suite for the equip service has been asserting against a slot vocabulary the application does not use, and it passes today for exactly the reason this task exists: nothing validates the slot.

When the refusal lands, all 15 fail. **The fix is to correct the fixtures to `"MAIN_HAND"`, not to loosen the rule.** `EQUIPMENT_SLOTS` at `lib/rules/inventory.ts:393` is the vocabulary, `prisma/schema.prisma:292` stores it as a free-form string, and the action route writes `"MAIN_HAND"`. The test was wrong; the rule is right. Record this in the ledger as a finding, not as incidental churn — it is a third instance of this repository's signature shape, and the one that best explains why the validation gap survived review.

Before changing them, confirm the claim yourself rather than trusting this plan:

```bash
grep -c '"mainHand"' tests/rules/equipment-service-contract.test.ts
grep -rn "mainHand\|offHand" --include=*.ts --include=*.tsx lib/ app/ components/
```

The second command returning nothing is the evidence. If it returns a production hit, stop and report — the vocabulary question is then genuinely open and this plan's premise is wrong.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules/inventory.test.ts`:

```ts
describe("equipItem slot legality", () => {
  const sword = {
    id: "sword",
    characterId: "c1",
    name: "Longsword",
    type: "weapon",
    quantity: 1,
    properties: { damageDice: "1d8" },
    equippedSlot: null,
  };
  const mail = {
    id: "mail",
    characterId: "c1",
    name: "Chain Mail",
    type: "armor",
    quantity: 1,
    properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
    equippedSlot: null,
  };

  it("refuses a weapon placed in the armour slot", () => {
    expect(() => equipItem("sword", "ARMOR", [sword, mail])).toThrow(RangeError);
    expect(() => equipItem("sword", "ARMOR", [sword, mail])).toThrow(
      /cannot occupy "ARMOR"/,
    );
  });

  it("refuses body armour placed in the off hand", () => {
    expect(() => equipItem("mail", "OFF_HAND", [sword, mail])).toThrow(RangeError);
  });

  it("refuses a slot that is not a slot", () => {
    expect(() => equipItem("sword", "HEAD", [sword, mail])).toThrow(RangeError);
  });

  it("still equips a legal placement, and still evicts the prior occupant", () => {
    const occupied = [{ ...sword, equippedSlot: null }, { ...mail, equippedSlot: "ARMOR" }];
    const other = {
      ...mail,
      id: "plate",
      name: "Plate",
      properties: { baseAC: 18, armorClass: "heavy", addDexModifier: false },
      equippedSlot: null,
    };
    const result = equipItem("plate", "ARMOR", [...occupied, other]);
    expect(result.find((i) => i.id === "plate")?.equippedSlot).toBe("ARMOR");
    expect(result.find((i) => i.id === "mail")?.equippedSlot).toBeNull();
  });

  it("still reports an unknown item, and reports it as not found rather than illegal", () => {
    expect(() => equipItem("ghost", "MAIN_HAND", [sword])).toThrow(/not found/);
  });
});
```

Append to `tests/rules/equipment-service-contract.test.ts`, inside the existing `describe("equipCharacterItem service contract", …)` block so it picks up the `equipCharacterItem` bound in `beforeEach`. It uses the file's own `createTx` helper (defined at line 79), which returns `{ state, tx }` — pass the `tx`, and assert on `tx.inventoryItem.update`:

```ts
  it("maps an illegal placement to ILLEGAL_SLOT_FOR_ITEM and writes nothing", async () => {
    const { tx } = createTx(baseItems);

    await expect(
      equipCharacterItem({
        campaignId: "campaign-1",
        characterId: "character-1",
        itemId: "sword-1",
        targetSlot: "ARMOR",
        tx,
      })
    ).rejects.toMatchObject({
      name: "EquipmentServiceError",
      code: "ILLEGAL_SLOT_FOR_ITEM",
    });

    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });
```

> Read `baseItems` at the top of the file and use the id, campaignId and characterId of an actual **weapon** fixture that belongs to the character under test — the ids above are illustrative. The item must pass the ownership assertions, or the test will pass for the wrong reason: it would reject with `ITEM_NOT_FOUND` before ever reaching the slot check, and the `code` assertion would catch that. Do not add a second db helper; `createTx` is the one this file uses.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run tests/rules/inventory.test.ts tests/rules/equipment-service-contract.test.ts --maxWorkers=2
```

Expected: FAIL — `equipItem` returns an array instead of throwing, and the service resolves instead of rejecting.

- [ ] **Step 3: Add the refusal to `equipItem`**

In `lib/rules/inventory.ts`, add to the imports:

```ts
import { slotAccepts, slotFor } from "@/lib/rules/equipment-slot";
```

Replace the docblock and the guard at `lib/rules/inventory.ts:141-160` so the function reads:

```ts
/**
 * Returns a new inventory array with `itemId` equipped into `targetSlot`.
 *
 * Rules enforced:
 * - The placement must be the one `slotFor` would choose for the item. A
 *   longsword may not occupy ARMOR, and an arbitrary string is not a slot.
 * - Each slot may hold at most one item — the previous occupant is unequipped.
 * - An item moving to a new slot is removed from its old slot automatically.
 * - Operation is idempotent if the item already occupies the target slot.
 * - Original array and items are never mutated.
 *
 * @throws {RangeError} if `itemId` is not found in `inventory`, or if the item
 *   cannot occupy `targetSlot`.
 */
export function equipItem(
  itemId: string,
  targetSlot: string,
  inventory: InventoryItem[]
): InventoryItem[] {
  const target = inventory.find((i) => i.id === itemId);
  if (!target) {
    throw new RangeError(`Item "${itemId}" not found in inventory.`);
  }

  if (!slotAccepts(target, targetSlot)) {
    throw new RangeError(
      `Item "${target.name}" cannot occupy "${targetSlot}"; it belongs in ` +
        `"${slotFor(target).slot}".`
    );
  }

  return inventory.map((item) => {
```

Leave the body of the `map` exactly as it is.

> The two modules now reference each other, but there is no runtime cycle: Task 1 imports `EQUIPMENT_SLOTS` with `import type`, which TypeScript erases. If you find yourself needing `EQUIPMENT_SLOTS` as a *value* inside `equipment-slot.ts`, stop — that closes the cycle. Move the tuple into `equipment-slot.ts` and re-export it from `inventory.ts` instead, keeping exactly one definition, and record the deviation.

- [ ] **Step 4: Add the error code and map the refusal**

In `lib/rules/equipment-service.ts`, extend the union at line 4:

```ts
export type EquipmentServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "ITEM_OWNERSHIP_MISMATCH"
  | "ILLEGAL_SLOT_FOR_ITEM";
```

In `equipCharacterItem`, wrap the `equipItem` call so the refusal crosses the boundary as a service error. Replace the line `const updated = equipItem(input.itemId, input.targetSlot, characterItems);` with:

```ts
  let updated: EquipmentInventoryItem[];
  try {
    updated = equipItem(
      input.itemId,
      input.targetSlot,
      characterItems
    ) as EquipmentInventoryItem[];
  } catch (error) {
    // `assertItemOwnership` has already proved the item exists, so the only
    // RangeError reachable here is an illegal placement.
    if (error instanceof RangeError) {
      throw new EquipmentServiceError("ILLEGAL_SLOT_FOR_ITEM", error.message);
    }
    throw error;
  }
```

This must sit **before** the `db.inventoryItem.update` calls, so a refused placement writes nothing.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm exec vitest run tests/rules/inventory.test.ts tests/rules/equipment-service-contract.test.ts --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 6: Run the full suite**

```bash
pnpm exec vitest run --maxWorkers=2
```

Expected: PASS. Existing tests that call `equipItem` with a slot the rule now rejects will fail here — that is the point of the change, not a regression to route around. For each failure, decide whether the test was asserting a placement that was always wrong (fix the test's fixture to a legal placement) or whether the rule is wrong (stop and report). Record the decision.

- [ ] **Step 7: Commit**

```bash
git add lib/rules/inventory.ts lib/rules/equipment-service.ts tests/rules/inventory.test.ts tests/rules/equipment-service-contract.test.ts
git commit -m "feat(equipment): refuse a placement the slot rule would not choose"
```

---

### Task 3: The route stops deciding

**Files:**
- Modify: `app/api/campaign/[id]/action/route.ts:939-941`
- Test: `tests/api/action-intent-contract.test.ts` (append)

**Interfaces:**
- Consumes: `slotFor(item: SlotCandidate): SlotDecision` from Task 1.
- Produces: nothing new. The `EQUIP_ITEM` game event keeps its existing payload shape `{ itemId, itemName, targetSlot }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/action-intent-contract.test.ts`. This file deliberately does **not** mock `parseIntent`: it drives real player text through the real gates, which is the only path where this defect is visible. Its comments are in Spanish — match that.

The harness is already there: `contextFor({ inventory })` builds the character, `post(text)` drives the route. `$transaction` is mocked as `cb(prisma)`, so the route's `tx` **is** the `prisma` mock — the eviction is `prisma.inventoryItem.updateMany` and the placement is `prisma.inventoryItem.update`.

```ts
describe("la puerta de equipar enruta por categoría, no por tipo", () => {
  // Las Ashwalker Boots son `type: "armor"` en data/loot-tables.json y no
  // llevan categoría de armadura. Antes de la regla de slots iban a ARMOR, lo
  // que desequipaba la armadura de cuerpo y apagaba en silencio la penalización
  // por competencia sobre ataques, pruebas de FUE/DES y lanzamiento.
  const CON_BOTAS = [
    {
      id: "mail",
      name: "Chain Mail",
      type: "armor",
      quantity: 1,
      properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
      equippedSlot: "ARMOR",
    },
    {
      id: "boots",
      name: "Ashwalker Boots",
      type: "armor",
      quantity: 1,
      properties: { effect: "ignore_difficult_terrain_ash" },
      equippedSlot: null,
    },
  ];

  it("no desaloja la armadura de cuerpo al equipar unas botas", async () => {
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({ inventory: CON_BOTAS })
    );

    await post("I put on the Ashwalker Boots");

    // La colocación va al slot de accesorio.
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "boots" },
        data: { equippedSlot: "ACCESSORY" },
      })
    );

    // Y el desalojo apunta a ACCESSORY, así que la cota de malla sigue puesta.
    // Esta es la aserción que falla si se revierte todo el incremento.
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ equippedSlot: "ACCESSORY" }),
      })
    );
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ equippedSlot: "ARMOR" }),
      })
    );
  });

  it("manda el escudo a la mano libre, no al slot de armadura", async () => {
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({
        inventory: [
          {
            id: "shield",
            name: "Shield",
            type: "armor",
            quantity: 1,
            properties: { baseAC: 2, armorClass: "shield" },
            equippedSlot: null,
          },
        ],
      })
    );

    await post("I equip the Shield");

    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "shield" },
        data: { equippedSlot: "OFF_HAND" },
      })
    );
  });
});
```

> **Confirm the intent classifies before trusting a red bar.** `parseIntent` is real here, so if it does not return `actionType: "equip"` with `targetName` matching the item, the route never reaches the equip gate and the test fails for the wrong reason — which would look identical to the failure you want. Add a temporary `expect(systemLogs())` dump, or assert `prisma.inventoryItem.update` was called *at all*, to confirm the gate is reached before asserting on the slot. Adjust the player text until it classifies; do not mock `parseIntent` to force it, because the unmocked classifier is this file's entire reason to exist.
>
> `beforeEach` in this file resets the prisma mocks — check that it does, and if it does not, clear `prisma.inventoryItem.update` and `.updateMany` at the top of each test, or the `not.toHaveBeenCalledWith` assertion will read calls from a previous test and pass or fail for unrelated reasons.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/api/action-intent-contract.test.ts --maxWorkers=2
```

Expected: FAIL — the boots are routed to `ARMOR` and the chain mail is unequipped.

- [ ] **Step 3: Replace the inline decision**

In `app/api/campaign/[id]/action/route.ts`, add to the imports:

```ts
import { slotFor } from "@/lib/rules/equipment-slot";
```

Replace lines 939-941:

```ts
      let targetSlot = "ACCESSORY";
      if (foundItem.type === "weapon") targetSlot = "MAIN_HAND";
      else if (foundItem.type === "armor") targetSlot = "ARMOR";
```

with:

```ts
      const { slot: targetSlot } = slotFor(foundItem);
```

Leave the `prisma.$transaction` block below it and the `EQUIP_ITEM` event exactly as they are. Slot exclusivity already worked; it was aiming at the wrong slot.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/api/action-intent-contract.test.ts --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 5: Confirm no second decision survived**

```bash
grep -rn '"ARMOR"\|"MAIN_HAND"\|"OFF_HAND"\|"ACCESSORY"' app/ lib/ --include=*.ts --include=*.tsx | grep -v equipment-slot.ts
```

Read every hit. A slot literal in a `where` clause or a UI label is fine; a second place that *decides* which slot an item belongs in is a finding — report it rather than fixing it silently, because a second decider is the defect this task removes.

- [ ] **Step 6: Full suite, then commit**

```bash
pnpm exec vitest run --maxWorkers=2
```

```bash
git add app/api/campaign/\[id\]/action/route.ts tests/api/action-intent-contract.test.ts
git commit -m "fix(equipment): stop the action route deciding slots by type alone"
```

---

### Task 4: Make armour obtainable

**Files:**
- Modify: `data/loot-tables.json` — two rows only, at approximately line 267 (`Ironwood Shield Fragment`, `uncommon` bucket) and line 547 (`Tomb Warden's Cuirass`, `very_rare` bucket)
- Create: `tests/rules/armor-obtainable.test.ts`
- Modify: `tests/rules/equipment-slot.test.ts` — Step 5 replaces the loot-routing assertion Task 1 wrote, which this task's data change makes false by design

**Interfaces:**
- Consumes: `slotFor` from Task 1; `selectBodyArmor(inventory: readonly ArmorInventoryRow[]): ArmorProfile | null` and `armorClassFor` from `lib/rules/armor-class.ts`; `armorPenaltyFor(input: { inventory: readonly ArmorInventoryRow[]; characterClass: string }): ArmorPenalty` from `lib/rules/armor-proficiency.ts`.
- Produces: no new symbols. It produces *data* — the first rows in the game that `readArmorProfile` can read a category from.

**Why this task exists:** every writer of `InventoryItem` in production draws from `data/loot-tables.json` or from `buildStartingInventory`, and none of them can produce a row carrying `properties.armorClass`. So `selectBodyArmor` returns `null` for every character, and the proficiency rule shipped last increment cannot fire. See the spec's "Correction" section for the enumeration.

**The category is authored, not inferred.** These two values are written into the data file by hand, as a deliberate authoring decision. Do not add code that guesses a category from an item's name, description, or icon path — putting a rules decision in a heuristic over prose is the failure this project exists to avoid.

- [ ] **Step 1: Write the failing test**

Create `tests/rules/armor-obtainable.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { armorClassFor, selectBodyArmor } from "@/lib/rules/armor-class";
import { armorPenaltyFor } from "@/lib/rules/armor-proficiency";
import { slotFor } from "@/lib/rules/equipment-slot";

/**
 * The armour stack had no producer. `buildStartingInventory` grants a weapon
 * and a consumable; loot and both trade paths draw from this file, where no
 * armour row carried a category. `selectBodyArmor` therefore returned null for
 * every character in the game, and the proficiency rule shipped in the previous
 * increment could not fire in production.
 *
 * These assertions read the real file, so they fail if the categories are ever
 * dropped from the data — which is the only way the rule goes dormant again.
 */
const LOOT = JSON.parse(
  readFileSync(join(process.cwd(), "data", "loot-tables.json"), "utf8"),
) as Record<string, Array<Record<string, unknown>>>;

function row(name: string): Record<string, unknown> {
  const found = Object.values(LOOT)
    .filter(Array.isArray)
    .flat()
    .find((item) => (item as Record<string, unknown>).name === name) as
    | Record<string, unknown>
    | undefined;
  if (!found) throw new Error(`Fixture drift: "${name}" is not in loot-tables.json`);
  return found;
}

function asInventoryRow(name: string, equippedSlot: string) {
  const source = row(name);
  return {
    id: name,
    characterId: "c1",
    name,
    type: String(source.type),
    quantity: 1,
    properties: source.properties,
    equippedSlot,
  };
}

describe("body armour is obtainable from the loot tables", () => {
  it("routes the Cuirass to the armour slot", () => {
    const cuirass = row("Tomb Warden's Cuirass");
    expect(slotFor({ type: "armor", properties: cuirass.properties })).toEqual({
      slot: "ARMOR",
      reason: "body-armour",
    });
  });

  it("selectBodyArmor finds it once equipped", () => {
    const profile = selectBodyArmor([asInventoryRow("Tomb Warden's Cuirass", "ARMOR")]);
    expect(profile).not.toBeNull();
    expect(profile?.category).toBe("medium");
  });

  it("grants the SRD breastplate's armour class", () => {
    // Breastplate: base 14, medium, DEX capped at +2. A DEX modifier of +3 is
    // capped, which is what distinguishes medium from light: 14 + 2, not 14 + 3.
    expect(
      armorClassFor({
        inventory: [asInventoryRow("Tomb Warden's Cuirass", "ARMOR")],
        dexModifier: 3,
      }).armorClass,
    ).toBe(16);
  });

  it("fires the proficiency penalty for a class without medium armour", () => {
    const inventory = [asInventoryRow("Tomb Warden's Cuirass", "ARMOR")];
    expect(armorPenaltyFor({ inventory, characterClass: "wizard" })).toEqual({
      applies: true,
      category: "medium",
    });
    expect(armorPenaltyFor({ inventory, characterClass: "fighter" })).toEqual({
      applies: false,
      category: "medium",
    });
  });
});

describe("the shield is a shield", () => {
  it("routes the Shield Fragment to the off hand", () => {
    const shield = row("Ironwood Shield Fragment");
    expect(slotFor({ type: "armor", properties: shield.properties })).toEqual({
      slot: "OFF_HAND",
      reason: "shield",
    });
  });

  it("is never selected as body armour", () => {
    expect(
      selectBodyArmor([asInventoryRow("Ironwood Shield Fragment", "OFF_HAND")]),
    ).toBeNull();
  });
});

describe("the other eight armour rows stay accessories", () => {
  it("routes every categoryless armour row to the accessory slot", () => {
    const armour = Object.values(LOOT)
      .filter(Array.isArray)
      .flat()
      .filter((item) => (item as Record<string, unknown>).type === "armor") as Array<
      Record<string, unknown>
    >;

    const accessories = armour.filter(
      (item) => slotFor({ type: "armor", properties: item.properties }).slot === "ACCESSORY",
    );

    expect(accessories).toHaveLength(8);
    expect(armour).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/rules/armor-obtainable.test.ts --maxWorkers=2
```

Expected: FAIL — the Cuirass routes to `ACCESSORY`, `selectBodyArmor` returns `null`, and there are 10 accessories rather than 8.

- [ ] **Step 3: Author the two categories**

In `data/loot-tables.json`, replace the `properties` object of `Tomb Warden's Cuirass` (around line 550):

```json
      "properties": {
        "baseAC": 14,
        "armorClass": "medium",
        "addDexModifier": true,
        "maxDexBonus": 2,
        "stealthDisadvantage": true,
        "ac_bonus": 2,
        "effect": "no_opportunity_attacks_vs_wearer"
      },
```

and the `properties` object of `Ironwood Shield Fragment` (around line 270):

```json
      "properties": {
        "baseAC": 2,
        "armorClass": "shield",
        "addDexModifier": false,
        "maxDexBonus": null,
        "ac_bonus": 1
      },
```

Notes on these values, so a reviewer can check them rather than trust them:

- The Cuirass is described as a breastplate. SRD Breastplate is Medium, AC 14, DEX capped at +2, Stealth disadvantage. Those are the SRD values, not invented ones.
- The Shield Fragment is described as a buckler. SRD Shield is base 2 — an additive bonus, which is why `selectBodyArmor` excludes the shield category and `armorClassFor` excludes base values below 10.
- `ac_bonus` is **kept on both rows and not removed**. It is read by no TypeScript file in the repository (searched as `ac_bonus` and `acBonus` across every `.ts`/`.tsx`), so deleting it changes no behaviour, and it is the input the deferred shield-and-bonus increment will need. Removing it would be deleting on the strength of a name search.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/rules/armor-obtainable.test.ts --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 5: Re-run Task 1's loot binding, which must now fail**

```bash
pnpm exec vitest run tests/rules/equipment-slot.test.ts --maxWorkers=2
```

Expected: **FAIL** on `"routes no loot row to the armour slot while none carries a category"`. That test was true when written and is now false by design — it is the tripwire firing exactly as intended. Update it to assert the new truth:

```ts
  it("routes exactly the two authored armour rows out of ACCESSORY", () => {
    const armour = lootRows().filter((row) => row.type === "armor");
    const byName = (slot: string) =>
      armour
        .filter(
          (row) => slotFor({ type: "armor", properties: row.properties }).slot === slot,
        )
        .map((row) => row.name)
        .sort();

    expect(byName("ARMOR")).toEqual(["Tomb Warden's Cuirass"]);
    expect(byName("OFF_HAND")).toEqual(["Ironwood Shield Fragment"]);
    expect(byName("ACCESSORY")).toHaveLength(8);
  });
```

- [ ] **Step 6: Full suite**

```bash
pnpm exec vitest run --maxWorkers=2
```

Expected: PASS. Pay attention to `tests/rules/loot.test.ts` and any trade test that asserts on the shape of these two rows — they may assert a `properties` object by equality. Update such assertions to the new shape; do not revert the data.

- [ ] **Step 7: Commit**

```bash
git add data/loot-tables.json tests/rules/armor-obtainable.test.ts tests/rules/equipment-slot.test.ts
git commit -m "feat(loot): give the two armour rows the category their fiction claims"
```

---

## Whole-branch review

Per the method that found two criticals the per-task reviews missed on the previous branch, this is **not optional** and does not substitute for the per-task gates.

- [ ] **Step 1: Full diff review against the spec**

```bash
git diff origin/master...HEAD
```

Read every hunk against `docs/superpowers/specs/2026-08-23-equipment-slot-authority-design.md`. For each spec claim, name the line that implements it.

- [ ] **Step 2: Dispatch the two auditors**

Dispatch `dormant-defect-hunter` and `mock-fidelity-auditor` over the branch diff. Both are read-only. The specific questions to put to them:

- To the defect hunter: is `slotFor` consumed by both writers, or did one keep deciding? Is `SlotReason` produced and never read? Did `ILLEGAL_SLOT_FOR_ITEM` gain a producer and a consumer, or only one?
- To the mock auditor: do the new route tests assert on a mock's own return value? Does `tests/rules/armor-obtainable.test.ts` genuinely read the real file, or did a fixture creep in?

- [ ] **Step 3: One fix wave**

Fix what the reviews find, in one pass, with a ruling recorded for anything deliberately not fixed.

- [ ] **Step 4: Final full suite**

```bash
pnpm exec vitest run --maxWorkers=2
```

```bash
pnpm typecheck && pnpm lint
```

A single test timing out is usually worker contention on this machine, not a failure — re-run that file in isolation before reporting it as broken.

---

## Deviations from the spec, ruled in advance

**The spec's SRD-projector test is not in this plan.** It asks for: project `data/srd-es/equipment.json` through `srdEquipmentProjection`, then route the result, asserting all 13 armours land in `ARMOR` except the Shield.

That test cannot be written honestly. `projectSrdItem` returns an `EquipmentInfo` — a lookup projection with a flat `armorCategory: string | null` field. `slotFor` reads an inventory row's `properties` blob through `readArmorProfile`, which looks for `armorClass`. Nothing in production converts one into the other, because nothing turns SRD equipment into inventory rows at all — that is precisely the finding recorded in the spec's Correction section. Writing the test would mean writing an adapter that exists only in the test, then asserting that the adapter works. It would prove a chain production does not have, which is the exact failure mode both auditor subagents were written to catch.

Task 4 replaces it with a binding that crosses a chain production **does** have: the real loot file → `slotFor` → `selectBodyArmor` → `armorPenaltyFor`. That is a longer chain and a real one.

If SRD equipment ever becomes purchasable, the projector-to-inventory adapter becomes production code and the spec's test becomes the right test. Not before.

## Out of scope, recorded

These are deliberately not in this plan. Each has a reason, and none should be quietly picked up mid-task.

- **More accessory slots.** `ACCESSORY` holds one item, so boots and a cloak still evict each other. That is today's behaviour and this plan does not worsen it. Fixing it needs a per-item slot no loot row carries.
- **Shield versus two-handed weapon.** Routing the shield to `OFF_HAND` makes a greatsword-plus-shield reachable. New rule, not a repair; the data exists (`Two-Handed` in `weaponProperties`).
- **The shield's +2 and `ac_bonus`.** `armorClassFor` has no notion of an additive bonus. Both the shield's base 2 and the `ac_bonus` field on three loot rows (`Ironwood Shield Fragment`, `Bonecage Helm`, `Tomb Warden's Cuirass`) wait on that increment.
- **Restoring `manageEquipment` to the narrator allowlist.** SEC-AI-001 PR 3's decision. This plan only makes the door safe before it opens.
- **The advantage/disadvantage divergence.** `resolveAbilityCheck:269` cancels; `resolveAttackRoll` lets advantage win outright. Pre-existing, unrelated to slots.
