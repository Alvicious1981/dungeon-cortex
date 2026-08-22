/**
 * lib/rules/starting-inventory.ts
 *
 * The inventory every new character starts with.
 *
 * The longsword's mechanical properties are hydrated from the SRD cache so the
 * row carries its category and traits — without them, every attack applied a
 * proficiency bonus the character may not have. The literal it replaces already
 * matched the SRD's `1d8` and slashing exactly, so no character's damage changes.
 *
 * Creating a character must not depend on the SRD cache being seeded: an empty
 * cache, or a lookup that throws, both fall back to the literal rather than
 * failing character creation.
 */

import { getEquipmentInfo } from "@/lib/rules/srd-equipment-lookup";

export async function buildStartingInventory() {
  const srd = await getEquipmentInfo("Longsword").catch(() => null);

  // A fresh development database has no SrdItem rows. Creating a character must
  // not depend on the cache being seeded, so an absent lookup keeps the literal.
  const weaponProperties = srd?.weaponCategory
    ? {
        damageDice: srd.damageDice ?? "1d8",
        damageBonus: 0,
        damageType: srd.damageType ?? "slashing",
        weaponCategory: srd.weaponCategory,
        weaponRange: srd.weaponRange,
        weaponProperties: srd.properties,
      }
    : { damageDice: "1d8", damageBonus: 0, damageType: "slashing" };

  return [
    {
      name: "Longsword",
      type: "weapon",
      quantity: 1,
      properties: weaponProperties,
    },
    {
      // Not hydrated: the SRD cache holds mundane gear only, and potions live
      // behind a different endpoint entirely.
      name: "Health Potion",
      type: "consumable",
      quantity: 2,
      properties: { healingDice: "2d4", healingBonus: 2 },
    },
  ];
}
