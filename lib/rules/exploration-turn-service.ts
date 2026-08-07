import {
  ExplorationTurnInputSchema,
  advanceTurn,
  applyRest,
  checkRandomEncounter,
  consumeResources,
  type ActiveLightSource,
  type CampaignTimeState,
  type PartyInventoryState,
} from "@/lib/rules/exploration";

export type ExplorationTurnServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_OWNERSHIP_MISMATCH"
  | "CHARACTER_NOT_FOUND"
  | "INVALID_EXPLORATION_TURN_INPUT"
  | "INVALID_EXHAUSTION_STATE"
  | "LEGACY_SUBSYSTEM_DISABLED";

export class ExplorationTurnServiceError extends Error {
  constructor(
    public readonly code: ExplorationTurnServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ExplorationTurnServiceError";
  }
}

interface ExplorationTurnCampaignRecord {
  id?: string;
  userId?: string | null;
  characterId?: string | null;
}

interface ExplorationTurnCharacterRecord {
  id: string;
  exhaustionLevel?: number | null;
}

interface ExplorationTurnEncounterRecord {
  combatants?: Array<{ id: string }>;
}

interface ExplorationTurnDb {
  $transaction?<T>(fn: (tx: ExplorationTurnDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<ExplorationTurnCampaignRecord | null | undefined>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<ExplorationTurnCharacterRecord | null | undefined>;
    update(args: {
      where: { id: string };
      data: { exhaustionLevel: number };
      select?: Record<string, boolean>;
    }): Promise<ExplorationTurnCharacterRecord>;
  };
  campaignTime: {
    findUnique(args: {
      where: { campaignId: string };
    }): Promise<(CampaignTimeState & { campaignId?: string }) | null | undefined>;
    upsert(args: {
      where: { campaignId: string };
      create: CampaignTimeState & { campaignId: string };
      update: CampaignTimeState;
    }): Promise<CampaignTimeState>;
  };
  partyInventory: {
    findUnique(args: {
      where: { campaignId: string };
    }): Promise<(PartyInventoryState & { campaignId?: string }) | null | undefined>;
    upsert(args: {
      where: { campaignId: string };
      create: PartyInventoryState & { campaignId: string };
      update: PartyInventoryState;
    }): Promise<PartyInventoryState>;
  };
  encounter: {
    findFirst(args: {
      where: { campaignId: string; status: string };
      select?: Record<string, unknown>;
    }): Promise<ExplorationTurnEncounterRecord | null | undefined>;
  };
}

export interface ResolveExplorationTurnInput {
  campaignId: string;
  userId?: string;
  actionType?: string;
  turnAction?: string;
  action?: string;
  turnsToAdvance?: number;
  randomEncounterRoll?: number;
  tx?: ExplorationTurnDb;
  db?: ExplorationTurnDb;
}

export interface ExplorationTurnFacts {
  type: "exploration_turn_resolved";
  campaignId: string;
  action: string;
  turnsAdvanced: number;
  campaignTime: CampaignTimeState;
  resources: PartyInventoryState;
  resourceChanges: {
    lightExpired: boolean;
    rationsDepleted: boolean;
    lightSourceAutoSelected: boolean;
    warnings: string[];
  };
  exhaustionApplied: boolean;
  encounter: { triggered: boolean; roll: number } | null;
}

export interface ResolveExplorationTurnResult {
  ok: true;
  action: string;
  turnsAdvanced: number;
  totalTurns: number;
  totalHours: number;
  restRequired: boolean;
  exhaustionApplied: boolean;
  encounter: { triggered: boolean; roll: number } | null;
  randomEncounter: { triggered: boolean; roll: number } | null;
  lightSource: ActiveLightSource;
  lightSourceTurnsLeft: number;
  lightExpired: boolean;
  rationsDepleted: boolean;
  warnings: string[];
  campaignTime: CampaignTimeState;
  resourceChanges: {
    before: PartyInventoryState;
    after: PartyInventoryState;
    lightExpired: boolean;
    rationsDepleted: boolean;
    lightSourceAutoSelected: boolean;
    warnings: string[];
  };
  facts: ExplorationTurnFacts;
}

const emptyCampaignTime: CampaignTimeState = {
  totalTurns: 0,
  totalHours: 0,
  totalDays: 0,
  turnsSinceRest: 0,
  turnsSinceEncounterCheck: 0,
  turnsSinceRation: 0,
};

const emptyPartyInventory: PartyInventoryState = {
  torches: 0,
  oilFlasks: 0,
  rations: 0,
  activeLightSource: "none",
  lightSourceTurnsRemaining: 0,
};

function resolveDb(input: ResolveExplorationTurnInput): ExplorationTurnDb {
  const injectedDb = input.tx ?? input.db;
  if (!injectedDb) {
    throw new ExplorationTurnServiceError(
      "LEGACY_SUBSYSTEM_DISABLED",
      "Legacy exploration-turn persistence is disabled until it is redesigned for D&D 5e/SRD 2014.",
    );
  }
  return injectedDb;
}

function normalizeTime(
  record: (CampaignTimeState & { campaignId?: string }) | null | undefined
): CampaignTimeState {
  return record
    ? {
        totalTurns: record.totalTurns,
        totalHours: record.totalHours,
        totalDays: record.totalDays,
        turnsSinceRest: record.turnsSinceRest,
        turnsSinceEncounterCheck: record.turnsSinceEncounterCheck,
        turnsSinceRation: record.turnsSinceRation,
      }
    : { ...emptyCampaignTime };
}

function normalizeInventory(
  record: (PartyInventoryState & { campaignId?: string }) | null | undefined
): PartyInventoryState {
  return record
    ? {
        torches: record.torches,
        oilFlasks: record.oilFlasks,
        rations: record.rations,
        activeLightSource: record.activeLightSource,
        lightSourceTurnsRemaining: record.lightSourceTurnsRemaining,
      }
    : { ...emptyPartyInventory };
}

function parseInput(input: ResolveExplorationTurnInput) {
  const parsed = ExplorationTurnInputSchema.safeParse({
    action: input.turnAction ?? input.actionType ?? input.action,
    turnsToAdvance: input.turnsToAdvance,
  });

  if (!parsed.success) {
    throw new ExplorationTurnServiceError(
      "INVALID_EXPLORATION_TURN_INPUT",
      "Invalid exploration turn input.",
      { issues: parsed.error.issues }
    );
  }

  return parsed.data;
}

async function resolveCampaign(
  db: ExplorationTurnDb,
  input: ResolveExplorationTurnInput
): Promise<ExplorationTurnCampaignRecord> {
  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, userId: true, characterId: true },
  });

  if (!campaign) {
    throw new ExplorationTurnServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  if (input.userId && campaign.userId && campaign.userId !== input.userId) {
    throw new ExplorationTurnServiceError(
      "CAMPAIGN_OWNERSHIP_MISMATCH",
      `Campaign ${input.campaignId} does not belong to user ${input.userId}.`
    );
  }

  return campaign;
}

function buildResult(input: {
  campaignId: string;
  action: string;
  turnsAdvanced: number;
  campaignTime: CampaignTimeState;
  inventoryBefore: PartyInventoryState;
  inventoryAfter: PartyInventoryState;
  restRequired: boolean;
  exhaustionApplied: boolean;
  encounter: { triggered: boolean; roll: number } | null;
  lightExpired: boolean;
  rationsDepleted: boolean;
  lightSourceAutoSelected: boolean;
  warnings: string[];
}): ResolveExplorationTurnResult {
  const resourceSummary = {
    before: input.inventoryBefore,
    after: input.inventoryAfter,
    lightExpired: input.lightExpired,
    rationsDepleted: input.rationsDepleted,
    lightSourceAutoSelected: input.lightSourceAutoSelected,
    warnings: input.warnings,
  };

  return {
    ok: true,
    action: input.action,
    turnsAdvanced: input.turnsAdvanced,
    totalTurns: input.campaignTime.totalTurns,
    totalHours: input.campaignTime.totalHours,
    restRequired: input.restRequired,
    exhaustionApplied: input.exhaustionApplied,
    encounter: input.encounter,
    randomEncounter: input.encounter,
    lightSource: input.inventoryAfter.activeLightSource,
    lightSourceTurnsLeft: input.inventoryAfter.lightSourceTurnsRemaining,
    lightExpired: input.lightExpired,
    rationsDepleted: input.rationsDepleted,
    warnings: input.warnings,
    campaignTime: input.campaignTime,
    resourceChanges: resourceSummary,
    facts: {
      type: "exploration_turn_resolved",
      campaignId: input.campaignId,
      action: input.action,
      turnsAdvanced: input.turnsAdvanced,
      campaignTime: input.campaignTime,
      resources: input.inventoryAfter,
      resourceChanges: {
        lightExpired: input.lightExpired,
        rationsDepleted: input.rationsDepleted,
        lightSourceAutoSelected: input.lightSourceAutoSelected,
        warnings: input.warnings,
      },
      exhaustionApplied: input.exhaustionApplied,
      encounter: input.encounter,
    },
  };
}

async function resolveExplorationTurnInTransaction(
  db: ExplorationTurnDb,
  input: ResolveExplorationTurnInput
): Promise<ResolveExplorationTurnResult> {
  const parsed = parseInput(input);
  // Validates campaign existence and ownership (throws on failure); the record
  // itself is no longer needed now that the exhaustion trigger is retired.
  await resolveCampaign(db, input);
  const [campaignTimeRecord, partyInventoryRecord, activeEncounter] = await Promise.all([
    db.campaignTime.findUnique({ where: { campaignId: input.campaignId } }),
    db.partyInventory.findUnique({ where: { campaignId: input.campaignId } }),
    db.encounter.findFirst({
      where: { campaignId: input.campaignId, status: "active" },
      select: { combatants: { where: { isPlayer: true }, select: { id: true } } },
    }),
  ]);

  const currentTime = normalizeTime(campaignTimeRecord);
  const currentInventory = normalizeInventory(partyInventoryRecord);

  if (parsed.action === "rest") {
    const nextTime = applyRest(currentTime);
    await db.campaignTime.upsert({
      where: { campaignId: input.campaignId },
      create: { campaignId: input.campaignId, ...nextTime },
      update: nextTime,
    });

    return buildResult({
      campaignId: input.campaignId,
      action: parsed.action,
      turnsAdvanced: 0,
      campaignTime: nextTime,
      inventoryBefore: currentInventory,
      inventoryAfter: currentInventory,
      restRequired: false,
      exhaustionApplied: false,
      encounter: null,
      lightExpired: false,
      rationsDepleted: false,
      lightSourceAutoSelected: false,
      warnings: ["The party rests for one turn. The rest cycle has been reset."],
    });
  }

  const turnResult = advanceTurn(currentTime, parsed.turnsToAdvance);
  // The non-canonical "skip the exploration rest cycle → +1 Exhaustion" trigger
  // has been retired: it is not part of the D&D 5e/SRD 2014 rules baseline.
  // Exhaustion increments must come from authoritative 5e mechanics elsewhere.
  // `exhaustionApplied` stays in the result (always false) to preserve the
  // existing contract shape without an interface migration.
  const exhaustionApplied = false;

  const partySize = activeEncounter?.combatants?.length ?? 1;
  const resourceResult = consumeResources(
    currentInventory,
    {
      rationConsumptionDue: turnResult.rationConsumptionDue,
      partySize,
    },
    turnResult.turnsAdvanced
  );

  let encounter: { triggered: boolean; roll: number } | null = null;
  if (turnResult.encounterCheckDue || parsed.action === "loud") {
    const result = checkRandomEncounter(
      parsed.action === "loud",
      input.randomEncounterRoll
    );
    encounter = { triggered: result.triggered, roll: result.roll };
  }

  await db.campaignTime.upsert({
    where: { campaignId: input.campaignId },
    create: { campaignId: input.campaignId, ...turnResult.next },
    update: turnResult.next,
  });
  await db.partyInventory.upsert({
    where: { campaignId: input.campaignId },
    create: { campaignId: input.campaignId, ...resourceResult.next },
    update: resourceResult.next,
  });

  return buildResult({
    campaignId: input.campaignId,
    action: parsed.action,
    turnsAdvanced: turnResult.turnsAdvanced,
    campaignTime: turnResult.next,
    inventoryBefore: currentInventory,
    inventoryAfter: resourceResult.next,
    restRequired: turnResult.restRequired,
    exhaustionApplied,
    encounter,
    lightExpired: resourceResult.lightExpired,
    rationsDepleted: resourceResult.rationsDepleted,
    lightSourceAutoSelected: resourceResult.lightSourceAutoSelected,
    warnings: resourceResult.warnings,
  });
}

export async function resolveExplorationTurn(
  input: ResolveExplorationTurnInput
): Promise<ResolveExplorationTurnResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return resolveExplorationTurnInTransaction(db, input);
  }

  return db.$transaction((tx) => resolveExplorationTurnInTransaction(tx, input));
}
