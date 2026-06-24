import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import {
  GenerateLocationInputSchema,
  MoveToNodeInputSchema,
  ExplorationTurnInputSchema,
  LocationPayloadSchema,
  generateLocationPayload,
  advanceTurn,
  consumeResources,
  checkRandomEncounter,
  applyRest,
  REST_INTERVAL_TURNS,
  type CampaignTimeState,
  type PartyInventoryState,
} from "@/lib/rules/exploration";
import { moveCampaignToNode, NavigationServiceError } from "@/lib/rules/navigation-service";
import { seededFloat } from "@/lib/rules/generators";
import { generateDungeon } from "@/lib/rules/dungeon";

export function buildExplorationTools(campaignId: string) {
  return {
    generateLocation: tool({
      description:
        "Generate a new procedural location when the player travels, explores, " +
        "or enters a new area. Creates a persistent graph of interconnected rooms/zones " +
        "that the player navigates node-by-node. " +
        "MUST be called BEFORE narrating any new environment. " +
        "NEVER describe rooms, exits, NPCs, or spatial layout that isn't in the response. " +
        "The returned nodes define the ONLY rooms that exist. Code is Law.",
      inputSchema: GenerateLocationInputSchema,
      execute: async ({ locationType, seed, parentLocationId }) => {
        try {
          const resolvedSeed = seed ?? String(Math.floor(seededFloat(`${campaignId}:loc`) * Number.MAX_SAFE_INTEGER));

          const existing = await prisma.location.findUnique({
            where: { campaignId_seed: { campaignId, seed: resolvedSeed } },
            include: {
              nodes: { orderBy: { index: "asc" } },
              edges: true,
            },
          });
          if (existing) {
            const nodeById = new Map(existing.nodes.map((n) => [n.id, n]));
            return JSON.stringify({
              ok: true,
              idempotent: true,
              locationId: existing.id,
              name: existing.name,
              type: existing.type,
              description: existing.description,
              seed: existing.seed,
              entryNodeIndex: 0,
              nodes: existing.nodes.map((n) => ({
                index: n.index, name: n.name, description: n.description,
                feature: n.feature, npcSeed: n.npcSeed, featureData: n.featureData,
                x: n.x, y: n.y,
              })),
              edges: existing.edges.map((e) => ({
                fromIndex: nodeById.get(e.fromNodeId)?.index ?? 0,
                toIndex: nodeById.get(e.toNodeId)?.index ?? 0,
                passageType: e.passageType,
              })),
            });
          }

          const dungeonMap =
            locationType === "dungeon"
              ? generateDungeon(resolvedSeed)
              : undefined;

          const payload = generateLocationPayload(
            { locationType, seed: resolvedSeed },
            { dungeonMap }
          );
          const validated = LocationPayloadSchema.parse(payload);

          const result = await prisma.$transaction(async (tx) => {
            const loc = await tx.location.create({
              data: {
                campaignId,
                seed: resolvedSeed,
                type: validated.type,
                name: validated.name,
                description: validated.description,
                parentId: parentLocationId ?? null,
              },
            });

            const createdNodes = await Promise.all(
              validated.nodes.map((node) =>
                tx.locationNode.create({
                  data: {
                    locationId: loc.id,
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

            const nodeIdByIndex = new Map(createdNodes.map((n) => [n.index, n.id]));

            await Promise.all(
              validated.edges.map((edge) => {
                const fromNodeId = nodeIdByIndex.get(edge.fromIndex);
                const toNodeId = nodeIdByIndex.get(edge.toIndex);
                if (!fromNodeId || !toNodeId) {
                  throw new Error(`Edge references unknown node index: ${edge.fromIndex}→${edge.toIndex}`);
                }
                return tx.locationEdge.create({
                  data: {
                    locationId: loc.id,
                    fromNodeId,
                    toNodeId,
                    passageType: edge.passageType,
                  },
                });
              })
            );

            const entryNodeId = nodeIdByIndex.get(validated.entryNodeIndex);
            await tx.campaign.update({
              where: { id: campaignId },
              data: {
                currentLocationId: loc.id,
                currentNodeId: entryNodeId,
              },
            });

            return { locationId: loc.id, entryNodeId };
          });

          return JSON.stringify({
            ok: true,
            locationId: result.locationId,
            entryNodeId: result.entryNodeId,
            ...validated,
          });
        } catch {
          return JSON.stringify({ error: "Location generation failed mechanically." });
        }
      },
    }),

    moveToNode: tool({
      description:
        "Move the player to an adjacent node within the current location. " +
        "The target node MUST be connected to the current node via an edge. " +
        "Call this when the player declares movement to a specific room or area. " +
        "After calling, narrate the movement and the destination using the returned node data. " +
        "NEVER describe a room the player hasn't moved to. Code is Law.",
      inputSchema: MoveToNodeInputSchema,
      execute: async ({ targetNodeIndex }) => {
        try {
          const result = await moveCampaignToNode({
            campaignId,
            toNodeIndex: targetNodeIndex,
          });

          return JSON.stringify({
            ok: true,
            targetNode: result.targetNode,
            adjacentNodes: result.adjacentNodes,
            passageType: result.passageType,
            explorationXPHints: result.explorationXPHints,
            facts: result.facts,
          });
        } catch (error) {
          if (error instanceof NavigationServiceError) {
            return JSON.stringify({
              error: error.message,
              code: error.code,
              ...error.details,
            });
          }

          return JSON.stringify({ error: "Movement failed mechanically." });
        }
      },
    }),
    executeExplorationTurn: tool({
      description:
        "Advance the dungeon clock by one exploration turn (10 minutes) for the given action. " +
        "MUST be called for every dungeon action the party takes — moving, searching, resting, " +
        "interacting, or making noise. " +
        "Handles torch/lantern burn, ration consumption, random encounter checks, " +
        "and mandatory rest enforcement automatically. " +
        "NEVER narrate the passage of time, torch burn, ration loss, exhaustion, or encounters " +
        "without calling this tool first. " +
        "If the response contains `restRequired: true`, the NEXT call MUST use action='rest'. " +
        "Voice the returned `warnings[]` diegetically. Code is Law.",
      inputSchema: ExplorationTurnInputSchema,
      execute: async ({ action, turnsToAdvance }) => {
        try {
          const [campaignRec, campaignTime, partyInventory] = await Promise.all([
            prisma.campaign.findUnique({
              where: { id: campaignId },
              select: { characterId: true },
            }),
            prisma.campaignTime.findUnique({ where: { campaignId } }),
            prisma.partyInventory.findUnique({ where: { campaignId } }),
          ]);

          if (!campaignRec) {
            return JSON.stringify({ error: "Campaign not found." });
          }

          const activeEncounter = await prisma.encounter.findFirst({
            where: { campaignId, status: "active" },
            select: { combatants: { where: { isPlayer: true }, select: { id: true } } },
          });
          const partySize = activeEncounter?.combatants.length ?? 1;

          const currentTime: CampaignTimeState = campaignTime ?? {
            totalTurns: 0,
            totalHours: 0,
            totalDays: 0,
            turnsSinceRest: 0,
            turnsSinceEncounterCheck: 0,
            turnsSinceRation: 0,
          };
          const currentInventory: PartyInventoryState = partyInventory
            ? {
                torches:                   partyInventory.torches,
                oilFlasks:                 partyInventory.oilFlasks,
                rations:                   partyInventory.rations,
                activeLightSource:         partyInventory.activeLightSource as "torch" | "lantern" | "none",
                lightSourceTurnsRemaining: partyInventory.lightSourceTurnsRemaining,
              }
            : {
                torches: 0,
                oilFlasks: 0,
                rations: 0,
                activeLightSource: "none",
                lightSourceTurnsRemaining: 0,
              };

          if (action === "rest") {
            const nextTime = applyRest(currentTime);
            await prisma.campaignTime.upsert({
              where: { campaignId },
              create: { campaignId, ...nextTime },
              update: nextTime,
            });
            return JSON.stringify({
              action: "rest",
              turnsAdvanced: 0,
              totalTurns: nextTime.totalTurns,
              totalHours: nextTime.totalHours,
              restRequired: false,
              encounter: null,
              lightSource: currentInventory.activeLightSource,
              lightSourceTurnsLeft: currentInventory.lightSourceTurnsRemaining,
              lightExpired: false,
              rationsDepleted: false,
              warnings: ["The party rests for one turn. The rest cycle has been reset."],
            });
          }

          const restAlreadyOverdue = currentTime.turnsSinceRest >= REST_INTERVAL_TURNS;
          const turnResult = advanceTurn(currentTime, turnsToAdvance);

          if (restAlreadyOverdue && turnResult.restRequired) {
            await prisma.character.update({
              where: { id: campaignRec.characterId },
              data: { exhaustionLevel: { increment: 1 } },
            });
          }

          const resourceResult = consumeResources(currentInventory, {
            rationConsumptionDue: turnResult.rationConsumptionDue,
            partySize,
          });

          let encounter: { triggered: boolean; roll: number } | null = null;
          if (turnResult.encounterCheckDue || action === "loud") {
            const enc = checkRandomEncounter(action === "loud");
            encounter = { triggered: enc.triggered, roll: enc.roll };
          }

          await prisma.$transaction([
            prisma.campaignTime.upsert({
              where: { campaignId },
              create: { campaignId, ...turnResult.next },
              update: turnResult.next,
            }),
            prisma.partyInventory.upsert({
              where: { campaignId },
              create: { campaignId, ...resourceResult.next },
              update: resourceResult.next,
            }),
          ]);

          return JSON.stringify({
            action,
            turnsAdvanced:      turnResult.turnsAdvanced,
            totalTurns:         turnResult.next.totalTurns,
            totalHours:         turnResult.next.totalHours,
            restRequired:       turnResult.restRequired,
            exhaustionApplied:  restAlreadyOverdue && turnResult.restRequired,
            encounter,
            lightSource:        resourceResult.next.activeLightSource,
            lightSourceTurnsLeft: resourceResult.next.lightSourceTurnsRemaining,
            lightExpired:       resourceResult.lightExpired,
            rationsDepleted:    resourceResult.rationsDepleted,
            warnings:           resourceResult.warnings,
          });
        } catch {
          return JSON.stringify({ error: "Exploration turn failed mechanically. The moment hangs suspended." });
        }
      },
    }),
  };
}
