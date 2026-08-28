# Equipment slot authority

**Date:** 2026-08-23
**Milestone:** V — adjacent (no grid dependency)
**Status:** designed
**Follows:** `docs/superpowers/specs/2026-08-22-armor-proficiency-authority-design.md`, which recorded this as the item PR 3 inherits

## Problem

The armour increment made a character's proficiency with their armour decide their attack rolls, their Strength and Dexterity checks, and whether they can cast at all. **One equip action switches all of it off.**

`app/api/campaign/[id]/action/route.ts:939-941` decides an item's slot with three lines:

```ts
let targetSlot = "ACCESSORY";
if (foundItem.type === "weapon") targetSlot = "MAIN_HAND";
else if (foundItem.type === "armor") targetSlot = "ARMOR";
```

Every armour-typed row goes to the single `ARMOR` slot, and the transaction below it evicts whatever was there. `data/loot-tables.json` ships **ten** rows typed `"armor"`, and eight of them are worn accessories: Thornweave Gloves, Shadowstep Slippers, Ashwalker Boots, Bonecage Helm, Voidclasp Gauntlet, Cloak of Diminished Silhouette, Shroud of Still Water, Gravewalker's Mantle. Equipping any one of them evicts the breastplate. `selectBodyArmor` then returns `null`, the penalty evaporates, casting is restored — and the fiction still has the character in chain mail.

A real shield does the same, and worse. The SRD's one Shield reaches an inventory row through `srd-equipment-projection.ts` as `type: "armor"` with `properties.armorClass: "shield"`, so it lands in `ARMOR` and evicts the body armour — and is then skipped by `selectBodyArmor`, which `continue`s past the shield category at `lib/rules/armor-class.ts:142`. The result is a slot that holds an item the armour rule declines to read: the character is wearing a shield, has no body armour as far as every rule is concerned, and the penalty is gone.

### The vocabulary was never the problem

`EQUIPMENT_SLOTS` (`lib/rules/inventory.ts:393`) already declares four slots:

```ts
["MAIN_HAND", "OFF_HAND", "ARMOR", "ACCESSORY"]
```

`ACCESSORY` exists and nothing is routed to it except by falling off the end of the `if/else`. The defect is not a missing slot. It is that **nothing decides slots as a rule, and nothing validates the decision**.

### Two writers, two different gaps

| Writer | Reached by | Gap |
| --- | --- | --- |
| `route.ts:939-951` | the live action route | Decides the slot itself, by `type` alone |
| `equipItem` (`inventory.ts:152`) → `equipCharacterItem` | the `manageEquipment` AI tool | Takes `targetSlot` as a parameter and validates **nothing** — not the item's type, not even membership in `EQUIPMENT_SLOTS` |

`equipItem` accepts any string. `equipCharacterItem` passes it through. Its only caller is the `manageEquipment` tool in `lib/ai/tools/world.ts`.

**That path is closed today, and is scheduled to reopen.** `lib/ai/tool-policy.ts` is a frozen allowlist of six read-only tools; `manageEquipment` is absent. But the file says why, in its own words: *"TEMPORARY, REVERSIBLE REDUCTION — the state-changing tools are inactive until SEC-AI-001 PR 3 restores them behind backend-authorised activation."*

So the second gap has an activation date. On the day equipment returns to the narrator, the AI will be able to place a longsword in `ARMOR` — an AI layer choosing a mechanical outcome, which is the one thing this project's architecture forbids. Fixing only the door in use, and leaving open the one scheduled to open, would trade a live defect for a dormant one.

### The data that decides it already exists

| Source | Armour entries | Carry a category |
| --- | --- | --- |
| `data/srd-es/equipment.json` | 13 (`equipment_category.index === "armor"`) | 13 — `armor_category`: Light 3, Medium 5, Heavy 4, Shield 1 |
| `data/loot-tables.json` | 10 (`type: "armor"`) | **0** |

Counted across every row of both files, not sampled. The two files do not share a shape: the SRD file is raw API JSON with `armor_category`, and `lib/rules/srd-equipment-projection.ts` is what turns it into the `properties.armorClass` an `InventoryItem` carries. `readArmorProfile` (`lib/rules/armor-class.ts`) reads that projected field. No loot row declares a slot either — `slot` and `equippedSlot` appear zero times in that file.

That asymmetry is the design. The armour **category** is exactly what separates a breastplate from a pair of boots, and `readArmorProfile` already reads it. A row with a recognised body-armour category is body armour; a row with `shield` is a shield; a row with no category is an accessory.

### Two loot rows this demotes, deliberately

Eight of the ten loot rows are worn accessories in the fiction as well as in the data. Two are not: **Tomb Warden's Cuirass** (*"a breastplate carved with runes of warding"*) and **Ironwood Shield Fragment**. Neither carries a category, so the rule routes both to `ACCESSORY` — a breastplate that is mechanically not body armour.

That is the right outcome for this increment, and the reason is worth stating rather than hiding. The alternative — guessing a category from the item's name or its icon path — would put a rules decision in a heuristic over prose, which is the failure mode this project exists to avoid. The honest fix is a category on the data row, which is a loot-data change, not a rule change.

Nothing is lost by the demotion, because those rows grant nothing today either way. The Cuirass's only mechanical field is `properties.ac_bonus: 2`, and **`ac_bonus` is read by no TypeScript file in the repository** — searched as `ac_bonus` and `acBonus` across every `.ts` and `.tsx`, zero matches outside the data file. It is this repository's signature defect shape, produced and never consumed, and it is out of scope here: it belongs with the shield's +2, in the increment that teaches armour class to accept bonuses. Recorded so it is not rediscovered.

## Scope

**In:** one pure rule that decides an item's slot and judges whether a placement is legal, consumed by both writers — the route stops deciding, and `equipItem` starts refusing.

**Out, with reasons:**

- **More accessory slots.** `ACCESSORY` holds one item, so boots and a cloak still evict each other. That is today's behaviour and this increment does not worsen it. Fixing it means new enum members, which ripple through the schema, the character sheet and the inventory UI — and it needs a per-item slot that **no loot row carries**, so it would require inventing that data first. A feature, not a repair.
- **Shield versus two-handed weapon.** Routing the shield to `OFF_HAND` makes this reachable: nothing stops a greatsword and a shield. The rule is a new one, not a repair of a broken one, and the data to write it already exists — the weapon increment left `Two-Handed` in `weaponProperties`. Clean follow-up.
- **The shield's +2 to armour class.** The armour increment deferred it explicitly and this one does not recover it. Worth noting that it now has a home: until this change a shield did not even occupy a coherent slot.
- **Restoring `manageEquipment` to the narrator.** That is SEC-AI-001 PR 3's decision, not this increment's. This work only ensures the door is safe when it opens.

## Architecture

### `lib/rules/equipment-slot.ts` — new, pure

```ts
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export interface SlotDecision {
  slot: EquipmentSlot;
  /** Why this slot, for the log and for a refusal message. */
  reason: "weapon" | "body-armour" | "shield" | "accessory";
}

export function slotFor(item: { type: string; properties: unknown }): SlotDecision;

export function slotAccepts(
  item: { type: string; properties: unknown },
  slot: string,
): boolean;
```

`slotFor` is the decision the route currently inlines. `slotAccepts` is the judgement `equipItem` currently lacks. They share one table, so a placement the rule would choose is always a placement it accepts — the two can never drift into disagreeing, which is the failure this repository keeps producing.

Pure: no database, no I/O, and it never throws. `InventoryItem.properties` is untyped JSON straight from Postgres, and an unreadable blob resolves to `ACCESSORY` — the slot that grants nothing, so a malformed row cannot be routed into the one place that would disable a rule.

### The decision rule

1. `type === "weapon"` → `MAIN_HAND`.
2. `type === "armor"`, category `light` / `medium` / `heavy` → `ARMOR`.
3. `type === "armor"`, category `shield` → `OFF_HAND`.
4. Everything else, including armour-typed rows with no readable category → `ACCESSORY`.

The category comes from `readArmorProfile`, so this rule and `selectBodyArmor` read the same field through the same reader. That matters: if they disagreed about what counts as body armour, an item could occupy `ARMOR` and still not be found there.

**`slotAccepts` is derived from `slotFor`, not written twice.** A placement is legal when it is the slot the rule would choose. That makes the two functions one rule with two questions, and makes "the rule chose X but rejects X" unrepresentable.

### What changes at each writer

**The route** (`action/route.ts:939-941`) replaces its `if/else` with `slotFor(foundItem).slot`. Its transaction below is unchanged — slot exclusivity already works; it was aiming at the wrong slot.

**`equipItem`** (`inventory.ts:152`) gains a refusal. It currently throws `RangeError` for an unknown item; an illegal placement becomes a refusal in the same shape. `equipCharacterItem` maps it to a new `EquipmentServiceErrorCode`, joining `CAMPAIGN_NOT_FOUND`, `ITEM_NOT_FOUND` and `ITEM_OWNERSHIP_MISMATCH`, so the AI tool's existing error path carries it with no new plumbing.

## Correction: no production path can create body armour today

This section was added after the spec was first written, when planning falsified one of its premises. It is kept rather than edited away, because the mistake is the spec's own subject.

The Problem section describes a loot accessory evicting "the breastplate". **No production path can put a breastplate in a character's inventory.** Enumerating every writer of the table — not searching for a literal, which cannot prove absence, since `loot-service.ts:328` writes `type: item.type` and is invisible to any name search:

| Writer | Source of the row | Can it produce `properties.armorClass`? |
| --- | --- | --- |
| `app/api/character/route.ts:89` → `buildStartingInventory` | hard-coded | No — one weapon, one consumable (`starting-inventory.ts:53,61`) |
| `lib/rules/loot-service.ts:324` | `data/loot-tables.json` | No — 0 of 10 armour rows carry a category |
| `lib/rules/trade-service.ts:334` | `data/loot-tables.json` (`trade.ts:26`, archetypes filter the loot tables) | No — same corpus |
| `app/actions/trade.ts:63` | same trade descriptor | No — same corpus |

The SRD corpus, the one that *does* carry `armor_category`, is reached only by `getEquipmentInfo` for lookup. It never becomes an inventory row.

**So `readArmorProfile` returns `category: null` for every row in the game, `selectBodyArmor` returns `null` for every character, and the armour proficiency rule shipped in the previous increment cannot fire in production.** It is the same defect shape as `isArmorProficient` was, one level down: last time the producer existed and the consumer did not; this time the consumer exists and the producer does not.

This does not make the slot rule wrong — it makes it *more* obviously right, since the ten loot rows genuinely are accessories. It changes only the urgency: the eviction this prevents is today accessory-evicts-accessory, not loot-evicts-your-armour. The scenario in the Problem section is what happens on the day armour becomes obtainable, which is a separate increment.

## What this changes for a live game

Nothing today, and everything the day loot drops.

As read at the start of this branch's work, the live save's single character owned two inventory rows — a Longsword and a Health Potion — and no armour, so no equip action currently reaches the armour branch. That read predates this spec; implementation should re-confirm it read-only before claiming the migration is inert. The moment a character equips any of the ten loot rows, today's behaviour silently disarms the proficiency rule and the new behaviour does not.

**The shield moves from `ARMOR` to `OFF_HAND`.** On the state read above no persisted row is affected, and the direction is strictly better regardless: a shield in `ARMOR` was evicting body armour and then being skipped anyway.

No schema change and no data migration: `equippedSlot` is already a free-form string column and `OFF_HAND` is already a member of `EQUIPMENT_SLOTS`.

## Testing

The previous increments' lesson applies directly: a guard that tests the leaf while claiming to test the chain is worse than no guard, because it reads as coverage.

- **Bound to the real loot file.** A test reads `data/loot-tables.json` itself and asserts that **no** row in it routes to `ARMOR`. All ten resolve to `ACCESSORY` today; if a future loot row gains a body-armour category, that test fails and someone decides deliberately. A hand-written fixture would repeat the mistake in a new place.
- ~~**Bound to the real SRD file, through the projector.**~~ **Withdrawn during planning.** `projectSrdItem` returns an `EquipmentInfo` with a flat `armorCategory`; `slotFor` reads an inventory row's `properties.armorClass`. Nothing in production converts one to the other — that is the Correction section's finding. The test would require an adapter existing only in the test, and would then assert that the adapter works: a chain production does not have. Replaced by a binding across a chain it does have — the real loot file through `slotFor`, `selectBodyArmor` and `armorPenaltyFor`. Revisit if SRD equipment becomes purchasable.
- **The two functions agree by construction**, and a test asserts it across every item shape: whatever `slotFor` chooses, `slotAccepts` permits.
- **The refusal is real.** `equipItem` refuses a longsword in `ARMOR` — the placement the AI will be able to attempt when `manageEquipment` returns — and the service maps it to its error code.
- **The route no longer decides.** A route-level case equipping a loot accessory while wearing body armour, asserting the body armour is **still equipped** afterwards. That is the defect in one assertion, and it is the one that would fail if this whole increment were reverted.

## Related

- `docs/superpowers/specs/2026-08-22-armor-proficiency-authority-design.md` — the increment this protects, which recorded this defect as PR 3's inheritance.
- `lib/ai/tool-policy.ts` — the frozen allowlist, and its own note that the reduction is temporary.
- `AGENTS.md` §Dormant defects — a value the AI layer can choose is the shape this closes before it activates.
