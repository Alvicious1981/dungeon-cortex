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
