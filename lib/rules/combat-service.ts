import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  deriveCombatBeat,
  extractConditions,
  type CombatConsequences,
  type EncounterSnapshot,
  type ResolveAttackInput,
} from "@/lib/rules/combat";
import { armorPenaltyFor } from "@/lib/rules/armor-proficiency";
import type { ArmorInventoryRow } from "@/lib/rules/armor-class";
import {
  executeCombatAction,
  type CombatActionPayload,
  type PipelineCombatant,
  type PipelineEncounterState,
} from "@/lib/rules/combat-pipeline";

export type CombatServiceErrorCode =
  | "ENCOUNTER_NOT_FOUND"
  | "ATTACKER_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "ATTACK_RESOLUTION_FAILED";

export class CombatServiceError extends Error {
  constructor(
    public readonly code: CombatServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CombatServiceError";
  }
}

interface CombatEncounterRecord {
  id: string;
  campaignId: string;
  round: number;
  currentTurnIndex: number;
  totalDamageDealt: number;
  status: string;
  combatants: PipelineCombatant[];
}

interface CombatCampaignRecord {
  characterId?: string | null;
  /**
   * The campaign's player character, read for the armour-proficiency penalty.
   * Optional because the same select is served by test doubles that predate it;
   * an absent character yields no penalty rather than a thrown read.
   */
  character?: {
    class: string;
    inventory: ArmorInventoryRow[];
  } | null;
}

interface CombatDb {
  encounter: {
    findFirst(args: {
      where: { campaignId: string; status: string };
      include: { combatants: boolean };
    }): Promise<CombatEncounterRecord | null>;
  };
  campaign: {
    findUnique(args: {
      where: { id: string };
      select: Record<string, unknown>;
    }): Promise<CombatCampaignRecord | null>;
  };
  /**
   * Optional: the real `prisma` client this module defaults to has it, but
   * the fixture doubles `tests/rules/combat-service-contract.test.ts` passes
   * as `tx`/`db` predate `CombatOutcome.systemLogs` and don't. Writing is
   * skipped rather than thrown on when it's absent, so this stays additive
   * for every existing caller.
   */
  gameLog?: {
    create(args: {
      data: { campaignId: string; role: string; content: string };
    }): Promise<unknown>;
  };
}

export interface ResolveCombatAttackInput extends ResolveAttackInput {
  campaignId: string;
  tx?: CombatDb;
  db?: CombatDb;
}

export type ResolveCombatAttackResult = { ok: true } & CombatConsequences;

function resolveDb(input: ResolveCombatAttackInput): CombatDb {
  return input.tx ?? input.db ?? (prisma as unknown as CombatDb);
}

function toEncounterStatus(status: string): PipelineEncounterState["status"] {
  return status === "active" ? "active" : "resolved";
}

function buildEncounterSnapshot(
  encounter: CombatEncounterRecord,
  defenderId: string,
  status: PipelineEncounterState["status"]
): EncounterSnapshot {
  const enemyCombatants = encounter.combatants.filter((combatant) => !combatant.isPlayer);

  return {
    round: encounter.round,
    totalDamageDealt: encounter.totalDamageDealt,
    status,
    currentBeat: "opening",
    defenderId,
    combatants: encounter.combatants.map((combatant) => ({
      id: combatant.id,
      isPlayer: combatant.isPlayer,
      hp: combatant.hp,
      maxHp: combatant.maxHp,
      hpBeforeThisTurn: combatant.hp,
      isBoss: !combatant.isPlayer && enemyCombatants.length === 1,
    })),
  };
}

function buildPipelineEncounter(
  encounter: CombatEncounterRecord,
  status: PipelineEncounterState["status"]
): PipelineEncounterState {
  return {
    id: encounter.id,
    round: encounter.round,
    currentTurnIndex: encounter.currentTurnIndex,
    totalDamageDealt: encounter.totalDamageDealt,
    status,
    combatants: encounter.combatants,
  };
}

function buildAttackPayload(input: {
  request: ResolveCombatAttackInput;
  encounter: CombatEncounterRecord;
  attacker: PipelineCombatant;
  defender: PipelineCombatant;
  status: PipelineEncounterState["status"];
  playerCharacterId?: string;
  campaign: CombatCampaignRecord | null;
}): CombatActionPayload {
  const { request, encounter, attacker, defender, status, playerCharacterId, campaign } =
    input;

  return {
    actionType: "attack",
    encounter: buildPipelineEncounter(encounter, status),
    actorId: request.attackerId,
    actorName: attacker.name,
    actorConditions: extractConditions(attacker.conditions),
    targetCombatants: [defender],
    weaponName: request.weaponDamageDice,
    weaponDice: request.weaponDamageDice,
    damageType: request.damageType,
    attackModifier: request.attackModifier,
    flatDamageBonus: 0,
    playerCharacterId,
    // The second producer of this payload. `actorArmorPenalty` is optional and
    // defaults to false downstream, so omitting it here would have let every
    // attack routed through `resolveCombatAttack` escape the penalty silently
    // — types checking, tests green. It is only ever the player's own armour:
    // enemy combatants carry no inventory to read.
    actorArmorPenalty: attacker.isPlayer
      ? armorPenaltyFor({
          inventory: campaign?.character?.inventory ?? [],
          characterClass: campaign?.character?.class ?? "",
        }).applies
      : false,
    collectEvents: false,
  };
}

export async function resolveCombatAttack(
  input: ResolveCombatAttackInput
): Promise<ResolveCombatAttackResult> {
  const db = resolveDb(input);
  const encounter = await db.encounter.findFirst({
    where: { campaignId: input.campaignId, status: "active" },
    include: { combatants: true },
  });

  if (!encounter) {
    throw new CombatServiceError("ENCOUNTER_NOT_FOUND", "No active encounter found.");
  }

  const attacker = encounter.combatants.find((combatant) => combatant.id === input.attackerId);
  if (!attacker) {
    throw new CombatServiceError(
      "ATTACKER_NOT_FOUND",
      `Attacker combatant '${input.attackerId}' not found in encounter.`
    );
  }

  const defender = encounter.combatants.find((combatant) => combatant.id === input.targetId);
  if (!defender) {
    throw new CombatServiceError(
      "TARGET_NOT_FOUND",
      `Target combatant '${input.targetId}' not found in encounter.`
    );
  }

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      characterId: true,
      // Inventory and class come along on the read that was already happening,
      // so the armour penalty costs no extra query.
      character: { select: { class: true, inventory: true } },
    },
  });

  const status = toEncounterStatus(encounter.status);
  const snapshot = buildEncounterSnapshot(encounter, input.targetId, status);
  const attackOutcome = await executeCombatAction(
    buildAttackPayload({
      request: input,
      encounter,
      attacker,
      defender,
      status,
      playerCharacterId: campaign?.characterId ?? undefined,
      campaign,
    }),
    db as unknown as Prisma.TransactionClient
  );

  // Same declared-refusal line the action route writes for the other two
  // executeCombatAction call sites (see `writeSystemLogs` in
  // app/api/campaign/[id]/action/route.ts) — this is the AI-tool entry point
  // for a weapon attack, so it needs its own write rather than sharing that
  // route's helper.
  for (const content of attackOutcome.systemLogs) {
    await db.gameLog?.create({ data: { campaignId: input.campaignId, role: "system", content } });
  }

  const consequences = attackOutcome.consequenceDetails?.[0];
  if (!consequences) {
    throw new CombatServiceError(
      "ATTACK_RESOLUTION_FAILED",
      "Attack resolution failed mechanically."
    );
  }

  const correctedTotal = snapshot.totalDamageDealt + consequences.combat_facts.damage;
  const finalBeat = deriveCombatBeat(
    { ...snapshot, totalDamageDealt: correctedTotal },
    consequences.combat_facts
  );

  return {
    ok: true,
    ...consequences,
    combat_beat: finalBeat,
  };
}
