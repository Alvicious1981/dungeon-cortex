import { abilityModifier } from "@/lib/rules/dice";
import {
  calculateFootprintDistance,
  normalizeSizeCategory,
  type TacticalMap,
} from "@/lib/rules/geometry";
import type { ContextCombatant } from "@/lib/memory/context";

interface WeaponProfileInput {
  properties: {
    weaponRange?: unknown;
    rangeNormal?: unknown;
    rangeLong?: unknown;
    throwRangeNormal?: unknown;
    throwRangeLong?: unknown;
    weaponProperties?: unknown;
  } | null | undefined;
  attacker: ContextCombatant;
  target: ContextCombatant;
  map: TacticalMap;
  actorStats: Record<string, number>;
}

export interface WeaponAttackProfile {
  distanceFt: number;
  maxRangeFt: number;
  longRangeDisadvantage: boolean;
  isMeleeAttack: boolean;
  attackAbilityModifier: number;
  damageAbilityModifier: number;
}

function normalizeWeaponProperties(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase());
}

function positiveNumber(input: unknown): number | null {
  return typeof input === "number" && input > 0 ? input : null;
}

function normalizeWeaponRange(input: unknown): "Melee" | "Ranged" | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  if (normalized === "melee") return "Melee";
  if (normalized === "ranged") return "Ranged";
  return null;
}

export function resolveWeaponAttackProfile(
  input: WeaponProfileInput
): WeaponAttackProfile {
  const { properties, attacker, target, map, actorStats } = input;
  const weaponProperties = normalizeWeaponProperties(properties?.weaponProperties);
  const meleeReachFt = weaponProperties.includes("reach") ? 10 : 5;
  const isThrownWeapon = weaponProperties.includes("thrown");
  const isFinesseWeapon = weaponProperties.includes("finesse");
  const weaponRange = normalizeWeaponRange(properties?.weaponRange);
  const baseNormalRangeFt = positiveNumber(properties?.rangeNormal) ?? 5;
  const baseLongRangeFt = Math.max(
    positiveNumber(properties?.rangeLong) ?? baseNormalRangeFt,
    baseNormalRangeFt
  );
  const throwNormalRangeFt = positiveNumber(properties?.throwRangeNormal);
  const throwLongRangeFt = throwNormalRangeFt
    ? Math.max(positiveNumber(properties?.throwRangeLong) ?? throwNormalRangeFt, throwNormalRangeFt)
    : null;
  const legacyThrownLongRangeFt = isThrownWeapon ? baseLongRangeFt : null;
  const distanceFt = calculateFootprintDistance(
    {
      id: attacker.id,
      x: attacker.x,
      y: attacker.y,
      size: normalizeSizeCategory(attacker.size),
    },
    {
      id: target.id,
      x: target.x,
      y: target.y,
      size: normalizeSizeCategory(target.size),
    },
    map.gridType,
    map.cellSize
  );

  const inferredWeaponRange: "Melee" | "Ranged" =
    weaponRange ??
    (isThrownWeapon
      ? "Melee"
      : baseLongRangeFt > meleeReachFt || baseNormalRangeFt > meleeReachFt
        ? "Ranged"
        : "Melee");
  const rangedNormalRangeFt =
    inferredWeaponRange === "Melee" && isThrownWeapon
      ? throwNormalRangeFt ?? baseNormalRangeFt
      : baseNormalRangeFt;
  const rangedLongRangeFt =
    inferredWeaponRange === "Melee" && isThrownWeapon
      ? throwLongRangeFt ?? legacyThrownLongRangeFt ?? rangedNormalRangeFt
      : baseLongRangeFt;
  const isMeleeAttack =
    inferredWeaponRange === "Melee" &&
    (!isThrownWeapon || distanceFt <= meleeReachFt || rangedLongRangeFt <= meleeReachFt);
  const strMod = abilityModifier(actorStats.STR ?? 10);
  const dexMod = abilityModifier(actorStats.DEX ?? 10);
  const finesseMod = Math.max(strMod, dexMod);
  const usesDexterity = !isMeleeAttack && inferredWeaponRange === "Ranged" && !isFinesseWeapon;
  const abilityModifierForAttack = usesDexterity
    ? dexMod
    : isFinesseWeapon
      ? finesseMod
      : strMod;

  return {
    distanceFt,
    maxRangeFt: isMeleeAttack ? meleeReachFt : rangedLongRangeFt,
    longRangeDisadvantage: !isMeleeAttack && distanceFt > rangedNormalRangeFt,
    isMeleeAttack,
    attackAbilityModifier: abilityModifierForAttack,
    damageAbilityModifier: abilityModifierForAttack,
  };
}
