import type { Prisma } from "@prisma/client";

/**
 * The one persisted initiative order used by encounter creation responses,
 * campaign presentation, campaign context, and turn authorization.
 *
 * initiativeOrder is non-null and unique within an encounter, so no database
 * row-return order or secondary tie-break is involved here.
 */
export const COMBATANT_INITIATIVE_ORDER = [
  { initiativeOrder: "asc" },
] satisfies Prisma.CombatantOrderByWithRelationInput[];

export interface TurnAuthorityCombatant {
  id: string;
  isPlayer: boolean;
}

export interface ActiveEncounterTurnState<
  TCombatant extends TurnAuthorityCombatant = TurnAuthorityCombatant,
> {
  id: string;
  currentTurnIndex: number;
  /** Combatants read with COMBATANT_INITIATIVE_ORDER. */
  combatants: TCombatant[];
}

export type EncounterTurnAuthority<
  TCombatant extends TurnAuthorityCombatant = TurnAuthorityCombatant,
> =
  | {
      ok: true;
      encounterId: string;
      currentTurnIndex: number;
      activeCombatant: TCombatant;
      playerCombatant: TCombatant;
      playerOwnsTurn: boolean;
    }
  | {
      ok: false;
      code: "INVALID_TURN_INDEX" | "INVALID_PLAYER_COMBATANT";
    };

/**
 * Resolves turn identity from a backend-loaded active encounter.
 *
 * The caller establishes existence/activity with an Encounter query filtered
 * by status="active". This function owns the remaining authority contract:
 * valid index, exactly one persisted player identity, and the indexed actor.
 */
export function resolveEncounterTurnAuthority<
  TCombatant extends TurnAuthorityCombatant,
>(encounter: ActiveEncounterTurnState<TCombatant>): EncounterTurnAuthority<TCombatant> {
  const { currentTurnIndex, combatants } = encounter;
  if (
    !Number.isInteger(currentTurnIndex) ||
    currentTurnIndex < 0 ||
    currentTurnIndex >= combatants.length
  ) {
    return { ok: false, code: "INVALID_TURN_INDEX" };
  }

  const playerCombatants = combatants.filter((combatant) => combatant.isPlayer);
  if (playerCombatants.length !== 1) {
    return { ok: false, code: "INVALID_PLAYER_COMBATANT" };
  }

  const activeCombatant = combatants[currentTurnIndex]!;
  const playerCombatant = playerCombatants[0]!;

  return {
    ok: true,
    encounterId: encounter.id,
    currentTurnIndex,
    activeCombatant,
    playerCombatant,
    playerOwnsTurn: activeCombatant.id === playerCombatant.id,
  };
}
