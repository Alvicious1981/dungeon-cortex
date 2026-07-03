import { prisma } from "@/lib/db/prisma";
import {
  LocationPayloadSchema,
  generateLocationPayload,
  type EdgePayload,
  type LocationPayload,
  type LocationType,
  type NodePayload,
} from "@/lib/rules/exploration";
import { seededFloat } from "@/lib/rules/generators";
import { generateDungeon } from "@/lib/rules/dungeon";

export type ExplorationServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_OWNERSHIP_MISMATCH"
  | "INVALID_LOCATION_INPUT"
  | "INVALID_LOCATION_GRAPH"
  | "INVALID_LOCATION_EDGE";

export class ExplorationServiceError extends Error {
  constructor(
    public readonly code: ExplorationServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ExplorationServiceError";
  }
}

interface ExplorationCampaignRecord {
  id: string;
  userId?: string | null;
  characterId?: string | null;
  currentLocationId?: string | null;
  currentNodeId?: string | null;
}

interface ExplorationLocationRecord {
  id: string;
  campaignId: string;
  seed: string | null;
  type: string;
  name: string;
  description: string;
  nodes?: ExplorationNodeRecord[];
  edges?: ExplorationEdgeRecord[];
}

interface ExplorationNodeRecord {
  id: string;
  locationId: string;
  index: number;
  name: string;
  description: string;
  feature: string;
  npcSeed?: string | null;
  featureData?: unknown;
  x?: number;
  y?: number;
}

interface ExplorationEdgeRecord {
  id: string;
  locationId: string;
  fromNodeId: string;
  toNodeId: string;
  passageType: string;
}

interface ExplorationDb {
  $transaction?<T>(fn: (tx: ExplorationDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<ExplorationCampaignRecord | null | undefined>;
    update(args: {
      where: { id: string };
      data: { currentLocationId: string; currentNodeId: string };
    }): Promise<ExplorationCampaignRecord>;
  };
  location: {
    findUnique(args: {
      where:
        | { id: string }
        | { campaignId_seed: { campaignId: string; seed: string } };
      include?: unknown;
      select?: Record<string, boolean>;
    }): Promise<ExplorationLocationRecord | null | undefined>;
    create(args: {
      data: {
        campaignId: string;
        seed: string;
        type: string;
        name: string;
        description: string;
        parentId: string | null;
      };
    }): Promise<ExplorationLocationRecord>;
  };
  locationNode: {
    create(args: {
      data: {
        locationId: string;
        index: number;
        name: string;
        description: string;
        feature: string;
        npcSeed: string | null;
        featureData: object;
        x: number;
        y: number;
      };
    }): Promise<ExplorationNodeRecord>;
  };
  locationEdge: {
    create(args: {
      data: {
        locationId: string;
        fromNodeId: string;
        toNodeId: string;
        passageType: string;
      };
    }): Promise<ExplorationEdgeRecord>;
  };
}

export interface GenerateExplorationLocationInput {
  campaignId: string;
  userId?: string;
  locationType: LocationType | string;
  seed?: string;
  parentLocationId?: string;
  generatedContent?: LocationPayload;
  tx?: ExplorationDb;
  db?: ExplorationDb;
}

export interface ExplorationLocationGeneratedFacts {
  type: "exploration_location_generated";
  campaignId: string;
  locationId: string;
  initialNodeId: string;
  nodeIds: string[];
  edgeIds: string[];
  locationType: string;
}

export interface GenerateExplorationLocationResult extends LocationPayload {
  ok: true;
  idempotent?: boolean;
  locationId: string;
  initialNodeId: string;
  entryNodeId: string;
  nodeIds: string[];
  edgeIds: string[];
  campaignUpdate: {
    currentLocationId: string;
    currentNodeId: string;
  };
  facts: ExplorationLocationGeneratedFacts;
}

function resolveDb(input: GenerateExplorationLocationInput): ExplorationDb {
  return input.tx ?? input.db ?? (prisma as unknown as ExplorationDb);
}

function isLocationType(value: string): value is LocationType {
  return ["tavern", "village", "dungeon", "wilderness", "ruins"].includes(value);
}

function assertBaseInput(input: GenerateExplorationLocationInput): void {
  if (!input.campaignId.trim() || !input.locationType || !isLocationType(input.locationType)) {
    throw new ExplorationServiceError(
      "INVALID_LOCATION_INPUT",
      "A campaignId and valid locationType are required."
    );
  }

  if (input.seed !== undefined && !input.seed.trim()) {
    throw new ExplorationServiceError("INVALID_LOCATION_INPUT", "Seed cannot be empty.");
  }
}

function buildPayload(input: GenerateExplorationLocationInput): LocationPayload {
  try {
    if (input.generatedContent) {
      return LocationPayloadSchema.parse(input.generatedContent);
    }

    const resolvedSeed =
      input.seed ??
      String(
        Math.floor(
          seededFloat(`${input.campaignId}:loc`) * Number.MAX_SAFE_INTEGER
        )
      );
    const dungeonMap =
      input.locationType === "dungeon" ? generateDungeon(resolvedSeed) : undefined;

    return LocationPayloadSchema.parse(
      generateLocationPayload(
        { locationType: input.locationType as LocationType, seed: resolvedSeed },
        { dungeonMap }
      )
    );
  } catch (error) {
    throw new ExplorationServiceError(
      "INVALID_LOCATION_GRAPH",
      "Generated location content is not a valid location graph.",
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

function assertGraph(payload: LocationPayload): void {
  const nodeIndexes = new Set(payload.nodes.map((node) => node.index));
  if (!nodeIndexes.has(payload.entryNodeIndex)) {
    throw new ExplorationServiceError(
      "INVALID_LOCATION_GRAPH",
      `Entry node index ${payload.entryNodeIndex} does not exist.`
    );
  }

  for (const edge of payload.edges) {
    if (!nodeIndexes.has(edge.fromIndex) || !nodeIndexes.has(edge.toIndex)) {
      throw new ExplorationServiceError(
        "INVALID_LOCATION_EDGE",
        `Edge references unknown node index: ${edge.fromIndex} to ${edge.toIndex}`,
        { fromIndex: edge.fromIndex, toIndex: edge.toIndex }
      );
    }
  }
}

function existingPayloadFromLocation(location: ExplorationLocationRecord): LocationPayload {
  const nodeById = new Map((location.nodes ?? []).map((node) => [node.id, node]));

  return {
    name: location.name,
    type: location.type as LocationType,
    description: location.description,
    seed: location.seed ?? "",
    entryNodeIndex: 0,
    nodes: (location.nodes ?? []).map((node) => ({
      index: node.index,
      name: node.name,
      description: node.description,
      feature: node.feature,
      npcSeed: node.npcSeed ?? null,
      featureData:
        typeof node.featureData === "object" && node.featureData !== null
          ? (node.featureData as Record<string, unknown>)
          : {},
      x: node.x ?? 0,
      y: node.y ?? 0,
    })) as NodePayload[],
    edges: (location.edges ?? []).map((edge) => ({
      fromIndex: nodeById.get(edge.fromNodeId)?.index ?? 0,
      toIndex: nodeById.get(edge.toNodeId)?.index ?? 0,
      passageType: edge.passageType,
    })) as EdgePayload[],
  };
}

function resultFromExisting(
  input: GenerateExplorationLocationInput,
  location: ExplorationLocationRecord
): GenerateExplorationLocationResult {
  const payload = existingPayloadFromLocation(location);
  const sortedNodes = [...(location.nodes ?? [])].sort((a, b) => a.index - b.index);
  const initialNode = sortedNodes.find((node) => node.index === payload.entryNodeIndex);
  const initialNodeId = initialNode?.id ?? sortedNodes[0]?.id ?? "";
  const nodeIds = sortedNodes.map((node) => node.id);
  const edgeIds = (location.edges ?? []).map((edge) => edge.id);

  return {
    ok: true,
    idempotent: true,
    locationId: location.id,
    initialNodeId,
    entryNodeId: initialNodeId,
    nodeIds,
    edgeIds,
    campaignUpdate: {
      currentLocationId: location.id,
      currentNodeId: initialNodeId,
    },
    facts: {
      type: "exploration_location_generated",
      campaignId: input.campaignId,
      locationId: location.id,
      initialNodeId,
      nodeIds,
      edgeIds,
      locationType: payload.type,
    },
    ...payload,
  };
}

async function generateExplorationLocationInTransaction(
  db: ExplorationDb,
  input: GenerateExplorationLocationInput
): Promise<GenerateExplorationLocationResult> {
  assertBaseInput(input);

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      id: true,
      userId: true,
      characterId: true,
      currentLocationId: true,
      currentNodeId: true,
    },
  });
  if (!campaign) {
    throw new ExplorationServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  if (input.userId && campaign.userId && campaign.userId !== input.userId) {
    throw new ExplorationServiceError(
      "CAMPAIGN_OWNERSHIP_MISMATCH",
      `Campaign ${input.campaignId} does not belong to user ${input.userId}.`
    );
  }

  const payload = buildPayload(input);
  assertGraph(payload);

  const existing = await db.location.findUnique({
    where: { campaignId_seed: { campaignId: input.campaignId, seed: payload.seed } },
    include: {
      nodes: { orderBy: { index: "asc" } },
      edges: true,
    },
  });
  if (existing?.nodes && existing.edges) {
    const existingResult = resultFromExisting(input, existing);
    if (existingResult.initialNodeId) {
      await db.campaign.update({
        where: { id: input.campaignId },
        data: {
          currentLocationId: existingResult.locationId,
          currentNodeId: existingResult.initialNodeId,
        },
      });
    }
    return existingResult;
  }

  const location = await db.location.create({
    data: {
      campaignId: input.campaignId,
      seed: payload.seed,
      type: payload.type,
      name: payload.name,
      description: payload.description,
      parentId: input.parentLocationId ?? null,
    },
  });

  const createdNodes = await Promise.all(
    payload.nodes.map((node) =>
      db.locationNode.create({
        data: {
          locationId: location.id,
          index: node.index,
          name: node.name,
          description: node.description,
          feature: node.feature,
          npcSeed: node.npcSeed,
          featureData: node.featureData as object,
          x: node.x,
          y: node.y,
        },
      })
    )
  );

  const nodeIdByIndex = new Map(createdNodes.map((node) => [node.index, node.id]));

  const createdEdges = await Promise.all(
    payload.edges.map((edge) => {
      const fromNodeId = nodeIdByIndex.get(edge.fromIndex);
      const toNodeId = nodeIdByIndex.get(edge.toIndex);
      if (!fromNodeId || !toNodeId) {
        throw new ExplorationServiceError(
          "INVALID_LOCATION_EDGE",
          `Edge references unknown node index: ${edge.fromIndex} to ${edge.toIndex}`,
          { fromIndex: edge.fromIndex, toIndex: edge.toIndex }
        );
      }

      return db.locationEdge.create({
        data: {
          locationId: location.id,
          fromNodeId,
          toNodeId,
          passageType: edge.passageType,
        },
      });
    })
  );

  const initialNodeId = nodeIdByIndex.get(payload.entryNodeIndex);
  if (!initialNodeId) {
    throw new ExplorationServiceError(
      "INVALID_LOCATION_GRAPH",
      `Entry node index ${payload.entryNodeIndex} was not created.`
    );
  }

  await db.campaign.update({
    where: { id: input.campaignId },
    data: {
      currentLocationId: location.id,
      currentNodeId: initialNodeId,
    },
  });

  const nodeIds = createdNodes.map((node) => node.id);
  const edgeIds = createdEdges.map((edge) => edge.id);

  return {
    ok: true,
    locationId: location.id,
    initialNodeId,
    entryNodeId: initialNodeId,
    nodeIds,
    edgeIds,
    campaignUpdate: {
      currentLocationId: location.id,
      currentNodeId: initialNodeId,
    },
    facts: {
      type: "exploration_location_generated",
      campaignId: input.campaignId,
      locationId: location.id,
      initialNodeId,
      nodeIds,
      edgeIds,
      locationType: payload.type,
    },
    ...payload,
  };
}

export async function generateExplorationLocation(
  input: GenerateExplorationLocationInput
): Promise<GenerateExplorationLocationResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return generateExplorationLocationInTransaction(db, input);
  }

  return db.$transaction((tx) =>
    generateExplorationLocationInTransaction(tx, input)
  );
}