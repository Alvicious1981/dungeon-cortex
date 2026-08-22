/**
 * lib/rules/weapon-profile-service.ts
 *
 * Fills in what a persisted weapon row does not say about itself.
 *
 * The pure rule lives in `weapon-profile.ts`; this is the only part that needs
 * the database, and it needs it only for rows written before a category was
 * ever stored. The split mirrors the previous increment: `spell-targeting.ts`
 * decides, `geometry.ts` calculates, `spell-resolution-service.ts` touches the
 * database.
 *
 * Server-only — never import from a client component.
 */

import { getEquipmentInfo } from "@/lib/rules/srd-equipment-lookup";
import { readWeaponProfile, type WeaponProfile } from "@/lib/rules/weapon-profile";

export interface WeaponRow {
  name: string;
  properties: unknown;
}

/**
 * Resolves a weapon's profile: what the row declares, then the SRD, then null.
 *
 * **Precedence:** a category on the row wins outright, and the lookup is not
 * even attempted. The SRD is the fallback, not an arbiter that overwrites what
 * was persisted — magic and modified weapons will depend on that.
 *
 * Only the category, ranged flag and traits are borrowed from the SRD. The
 * row's own damage survives, so a persisted `2d6 Radiant` longsword does not
 * revert to the mundane entry's `1d8 Slashing`.
 */
export async function resolveWeaponProfile(row: WeaponRow): Promise<WeaponProfile> {
  const declared = readWeaponProfile(row.properties);
  if (declared.category !== null) return declared;

  const srd = await getEquipmentInfo(row.name).catch(() => null);
  if (!srd) return declared;

  const fromSrd = readWeaponProfile({
    weaponCategory: srd.weaponCategory,
    weaponRange: srd.weaponRange,
    weaponProperties: srd.properties,
  });

  return {
    ...declared,
    category: fromSrd.category,
    isRanged: fromSrd.isRanged,
    traits: fromSrd.traits,
  };
}
