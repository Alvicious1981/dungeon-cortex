import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { armorClassFor, selectBodyArmor } from "@/lib/rules/armor-class";
import { armorPenaltyFor } from "@/lib/rules/armor-proficiency";
import { slotFor } from "@/lib/rules/equipment-slot";
import { rollIndividualRarity, type LootRarity } from "@/lib/rules/loot";

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
    //
    // Plus the row's own `ac_bonus: 2` — the runes of warding it has always
    // declared and nothing read. This assertion said 16 while that field was
    // inert; it says 18 now because the additive term consumes it, which makes
    // the Cuirass what its rarity always implied: a +2 breastplate.
    expect(
      armorClassFor({
        inventory: [asInventoryRow("Tomb Warden's Cuirass", "ARMOR")],
        dexModifier: 3,
      }).armorClass,
    ).toBe(18);
  });

  it("grants the buckler its shield base and its enchantment together", () => {
    // Ironwood Shield Fragment: SRD shield base 2, plus its own ac_bonus 1.
    // Nothing wore off — an unarmoured character holding it is 10 + DEX + 3.
    expect(
      armorClassFor({
        inventory: [asInventoryRow("Ironwood Shield Fragment", "OFF_HAND")],
        dexModifier: 2,
      }).armorClass,
    ).toBe(15);
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

describe("body armour is reachable by a real producer", () => {
  /**
   * The blacksmith is the only merchant archetype whose `preferredTypes`
   * includes "armor" (see `lib/rules/trade.ts`), and it caps at "rare" —
   * below the rarity bucket the only ARMOR-routing row(s) live in. So the
   * sole producer of body armour is a loot drop, and this test exists to
   * catch the moment that stops being true: someone re-tiers the loot
   * tables so the only body-armour row lands in a rarity bucket the loot
   * generator can never actually emit, and the armour proficiency rule goes
   * dormant again with every other test still green.
   *
   * "Reachable" is derived from `lib/rules/loot.ts` itself, not asserted by
   * name: `rollMagicItems` draws an item's table from `rollIndividualRarity`,
   * which — for every non-"mundane" ceiling `tensionToRarityBracket` can
   * produce — has a nonzero-probability branch landing on every rarity at or
   * below that ceiling. Sampling `rollIndividualRarity` over many seeds for
   * every reachable ceiling gives the true reachable set without hard-coding
   * a bucket name.
   */
  const SEEDS = Array.from({ length: 300 }, (_, i) => `reachability-probe-${i}`);

  function reachableMagicItemRarities(): Set<LootRarity> {
    const ceilings: LootRarity[] = ["mundane", "uncommon", "rare", "very_rare", "legendary"];
    const reachable = new Set<LootRarity>();

    for (const ceiling of ceilings) {
      // rollMagicItems returns [] outright for the "mundane" bracket, so no
      // rarity is reachable through it via that ceiling.
      if (ceiling === "mundane") continue;

      for (const seed of SEEDS) {
        reachable.add(rollIndividualRarity(ceiling, seed));
      }
    }

    return reachable;
  }

  function bucketsContainingArmorRows(): Set<string> {
    const buckets = new Set<string>();
    for (const [bucket, rows] of Object.entries(LOOT)) {
      if (!Array.isArray(rows)) continue;
      for (const item of rows) {
        if (item.type !== "armor") continue;
        if (slotFor({ type: "armor", properties: item.properties }).slot === "ARMOR") {
          buckets.add(bucket);
        }
      }
    }
    return buckets;
  }

  it("has at least one ARMOR-routing row in a rarity bucket the loot generator can emit", () => {
    const reachable = reachableMagicItemRarities();
    const armorBuckets = bucketsContainingArmorRows();

    expect(armorBuckets.size).toBeGreaterThan(0);

    const armorBucketsReachable = [...armorBuckets].filter((bucket) =>
      reachable.has(bucket as LootRarity),
    );

    // If this goes empty, the only body armour in the game sits in a bucket
    // no producer can reach: re-run `pnpm exec vitest run
    // tests/rules/armor-obtainable.test.ts` after any loot-table re-tier to
    // confirm the armour proficiency rule can still fire in production.
    expect(armorBucketsReachable.length).toBeGreaterThan(0);
  });
});
