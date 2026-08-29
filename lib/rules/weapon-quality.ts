/**
 * lib/rules/weapon-quality.ts
 *
 * What a weapon is made of, and whether it is magical, for the three qualities
 * the SRD's damage clauses actually ask about.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * ─── Why a bonus means magic ─────────────────────────────────────────────────
 * A declared quality is authoritative. Absent one, `damageBonus > 0` derives
 * `magical`, because in the SRD a weapon with a bonus to attack and damage
 * rolls *is* a magic weapon — the bonus is the definition, not a hint. That is
 * reading a mechanical field, which is a different act from reading prose: the
 * forty `effect` strings in the loot data stay unread for exactly that reason.
 *
 * An unrecognised quality grants nothing. A row is free to claim "blessed";
 * this module has no rule for it, and inventing one would be guessing at free
 * text, which is the line this project does not cross.
 */

export const WEAPON_QUALITIES = ["magical", "silvered", "adamantine"] as const;

export type WeaponQuality = (typeof WEAPON_QUALITIES)[number];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toQuality(value: unknown): WeaponQuality | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return (WEAPON_QUALITIES as readonly string[]).includes(normalised)
    ? (normalised as WeaponQuality)
    : null;
}

/**
 * The qualities an equipped weapon's persisted `properties` blob declares or
 * implies, de-duplicated and in the order this module decides them.
 */
export function weaponQualitiesFor(properties: unknown): readonly WeaponQuality[] {
  const root = asRecord(properties);
  if (root === null) return [];

  const declared = Array.isArray(root.qualities)
    ? root.qualities.map(toQuality).filter((quality): quality is WeaponQuality => quality !== null)
    : [];

  const qualities = new Set<WeaponQuality>(declared);

  const bonus = root.damageBonus;
  if (typeof bonus === "number" && Number.isFinite(bonus) && bonus > 0) {
    qualities.add("magical");
  }

  return [...qualities];
}
