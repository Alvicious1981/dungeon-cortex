/**
 * lib/rules/enemy-turn.ts
 *
 * One enemy's turn, planned: move, then attack the player
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §5).
 *
 * @pure — no database, no dice, never throws.
 *
 * The movement checks are exactly the player's Move gate: Chebyshev distance
 * against walk speed, the whole footprint inside the grid, and every footprint
 * square free. Ties go to the fewest squares moved, then the lowest y, then the
 * lowest x, so standing still wins any tie it is part of.
 */

import {
  chebyshevSquares,
  isFootprintWithinCombatGrid,
  isOccupied,
  minFootprintDistanceFt,
  sizeToSquares,
  type GridCombatant,
  type GridPoint,
} from "@/lib/rules/geometry";
import { isIncapacitated } from "@/lib/rules/conditions";
import {
  averageDamage,
  type MonsterAttackProfileV1,
  type ProfiledAttack,
} from "@/lib/rules/monster-attack-profile";

export type EnemyAttackMode = "melee" | "ranged" | "area-save";

export interface EnemyTurnInput {
  enemy: GridCombatant & {
    hp: number;
    conditions: readonly string[];
    profile: MonsterAttackProfileV1 | null;
  };
  player: GridCombatant;
  /** Every combatant except the acting enemy, the player included. */
  others: readonly GridCombatant[];
  /**
   * The player is at 0 HP. A downed player is no threat, so every enemy holds
   * (docs/superpowers/specs/2026-09-15-death-saves-design.md §1, §5).
   */
  playerDowned?: boolean;
  /** The enemy's areaSaveAttack, if it has one, is off recharge and ready
   * (docs/superpowers/specs/2026-09-16-area-save-actions-design.md §5, §6.2). */
  breathAvailable?: boolean;
}

export interface EnemyTurnPlan {
  move: GridPoint | null;
  mode: EnemyAttackMode | null;
  /** Attack names in resolution order, multiattack parts expanded by count. */
  attacks: string[];
  /** The area-save attack's name when the plan uses it; attacks is then
   * empty — the two are mutually exclusive within a turn. */
  areaSaveAttack: string | null;
}

function noAction(): EnemyTurnPlan {
  return { move: null, mode: null, attacks: [], areaSaveAttack: null };
}

function usable(
  attack: ProfiledAttack,
  from: GridCombatant,
  player: GridCombatant,
  mode: EnemyAttackMode,
): boolean {
  const distance = minFootprintDistanceFt(from, player);
  if (mode === "melee") return attack.melee !== null && distance <= attack.melee.reachFt;
  // Never adjacent and never at long range: the engine applies neither
  // disadvantage, so the planner never puts itself where one would apply.
  return attack.ranged !== null && distance > 5 && distance <= attack.ranged.normalFt;
}

function totalAverage(attack: ProfiledAttack): number {
  return attack.damage.reduce((sum, damage) => sum + averageDamage(damage.dice), 0);
}

function chooseAttacks(
  profile: MonsterAttackProfileV1,
  from: GridCombatant,
  player: GridCombatant,
  mode: EnemyAttackMode,
): string[] {
  const candidates = profile.attacks.filter((attack) => usable(attack, from, player, mode));
  if (candidates.length === 0) return [];

  const usableNames = new Set(candidates.map((attack) => attack.name));
  if (profile.multiattack && profile.multiattack.every((part) => usableNames.has(part.attack))) {
    return profile.multiattack.flatMap((part) => Array<string>(part.count).fill(part.attack));
  }

  const best = [...candidates].sort(
    (a, b) => totalAverage(b) - totalAverage(a) || a.name.localeCompare(b.name),
  )[0]!;
  return [best.name];
}

function withinAreaSaveReach(
  attack: { reachFt: number },
  from: GridCombatant,
  player: GridCombatant,
): boolean {
  return minFootprintDistanceFt(from, player) <= attack.reachFt;
}

type DestinationKey = [distanceFt: number, squaresMoved: number, y: number, x: number];

function isBefore(a: DestinationKey, b: DestinationKey): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}

function bestDestination(input: EnemyTurnInput): GridPoint {
  const { enemy, player, others } = input;
  const reach = Math.floor((enemy.profile?.walkSpeedFt ?? 0) / 5);
  const side = sizeToSquares(enemy.size);
  const occupants = [...others];

  let best: GridPoint = { x: enemy.x, y: enemy.y };
  let bestKey: DestinationKey = [minFootprintDistanceFt(enemy, player), 0, enemy.y, enemy.x];

  for (let y = enemy.y - reach; y <= enemy.y + reach; y++) {
    for (let x = enemy.x - reach; x <= enemy.x + reach; x++) {
      if (x === enemy.x && y === enemy.y) continue;
      const anchor = { x, y };
      if (!isFootprintWithinCombatGrid(anchor, enemy.size)) continue;

      let free = true;
      for (let dy = 0; dy < side && free; dy++) {
        for (let dx = 0; dx < side && free; dx++) {
          if (isOccupied({ x: x + dx, y: y + dy }, occupants)) free = false;
        }
      }
      if (!free) continue;

      const key: DestinationKey = [
        minFootprintDistanceFt({ ...enemy, x, y }, player),
        chebyshevSquares(anchor, enemy),
        y,
        x,
      ];
      if (isBefore(key, bestKey)) {
        best = anchor;
        bestKey = key;
      }
    }
  }
  return best;
}

/** The enemy's move and attacks this turn. @pure */
export function planEnemyTurn(input: EnemyTurnInput): EnemyTurnPlan {
  if (input.playerDowned) return noAction();
  const { enemy, player } = input;
  const profile = enemy.profile;
  if (enemy.hp <= 0 || profile === null || isIncapacitated(enemy.conditions)) return noAction();

  const destination = bestDestination(input);
  const moved = destination.x !== enemy.x || destination.y !== enemy.y;
  const atDestination = { ...enemy, x: destination.x, y: destination.y };

  // 0. Breathe from here, if charged and in range (spec §6.2, decision 3:
  // preferred over multiattack whenever it applies).
  const areaSave = profile.areaSaveAttack;
  if (areaSave && input.breathAvailable && withinAreaSaveReach(areaSave, enemy, player)) {
    return { move: null, mode: "area-save", attacks: [], areaSaveAttack: areaSave.name };
  }

  // 0a. Move, then breathe, if reach only covers the player after moving.
  if (areaSave && input.breathAvailable && moved && withinAreaSaveReach(areaSave, atDestination, player)) {
    return { move: destination, mode: "area-save", attacks: [], areaSaveAttack: areaSave.name };
  }

  // 1. Melee from here.
  const meleeHere = chooseAttacks(profile, enemy, player, "melee");
  if (meleeHere.length > 0) return { move: null, mode: "melee", attacks: meleeHere, areaSaveAttack: null };

  // 2. Close and strike.
  const meleeThere = chooseAttacks(profile, atDestination, player, "melee");
  if (moved && meleeThere.length > 0) {
    return { move: destination, mode: "melee", attacks: meleeThere, areaSaveAttack: null };
  }

  // 3. Shoot from here.
  const rangedHere = chooseAttacks(profile, enemy, player, "ranged");
  if (rangedHere.length > 0) return { move: null, mode: "ranged", attacks: rangedHere, areaSaveAttack: null };

  // 4. Advance, and shoot if that brings the player into range.
  if (moved) {
    const rangedThere = chooseAttacks(profile, atDestination, player, "ranged");
    return rangedThere.length > 0
      ? { move: destination, mode: "ranged", attacks: rangedThere, areaSaveAttack: null }
      : { move: destination, mode: null, attacks: [], areaSaveAttack: null };
  }

  // 5. Nothing: a ranged-only enemy adjacent to the player (known limitation).
  return noAction();
}
