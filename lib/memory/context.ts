/**
 * lib/memory/context.ts
 *
 * Context assembly for Milestone D — Memory and continuity.
 *
 * Gathers the three pillars of campaign context needed to build an AI prompt
 * or power any context-aware operation:
 *   1. Character — current stats, hp, spell slots, and inventory
 *   2. Active encounter — initiative order and combatant state (null if none)
 *   3. Recent logs — last 5 GameLog entries, oldest-first (for chronology)
 *
 * This module is pure fetch logic: it never mutates state.
 * Callers are responsible for error handling at the API boundary.
 */

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface ContextCharacter {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  hp: number;
  maxHp: number;
  /** Raw JSON — { STR, DEX, CON, INT, WIS, CHA } */
  stats: Prisma.JsonValue;
  /** Raw JSON spell slot map, or null if the character has no spellcasting. */
  spellSlots: Prisma.JsonValue | null;
  inventory: ContextInventoryItem[];
}

export interface ContextInventoryItem {
  id: string;
  name: string;
  type: string;
  quantity: number;
  properties: Prisma.JsonValue;
}

export interface ContextEncounter {
  id: string;
  round: number;
  currentTurnIndex: number;
  /** Ordered by initiativeTotal DESC — index 0 acts first. */
  combatants: ContextCombatant[];
  /** Spatial zone graph for this encounter — Zone[] serialised as JSON.
   *  Empty array means spatial tracking is disabled; all range checks pass. */
  zones: Prisma.JsonValue;
}

export interface ContextCombatant {
  id: string;
  name: string;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  initiativeTotal: number;
  /** Raw JSON string[] of active condition names. */
  conditions: Prisma.JsonValue;
  /** Zone.id within the encounter's zone graph, or null if unplaced. */
  currentZoneId: string | null;
}

export interface ContextLog {
  id: string;
  /** "user" | "assistant" | "system" */
  role: string;
  content: string;
  createdAt: Date;
}

export interface CampaignContext {
  character: ContextCharacter;
  /** The current active encounter, or null if no combat is in progress. */
  activeEncounter: ContextEncounter | null;
  /** Up to 5 most recent log entries, oldest-first. */
  recentLogs: ContextLog[];
}

// ---------------------------------------------------------------------------
// Assembly function
// ---------------------------------------------------------------------------

/**
 * Assembles the full context snapshot for a campaign in parallel.
 *
 * @throws {Error} if the campaign does not exist.
 */
export async function buildCampaignContext(
  campaignId: string
): Promise<CampaignContext> {
  const [campaign, activeEncounter, recentLogsDesc] = await Promise.all([
    // Pillar 1: character with inventory
    prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        character: {
          select: {
            id: true,
            name: true,
            race: true,
            class: true,
            level: true,
            hp: true,
            maxHp: true,
            stats: true,
            spellSlots: true,
            inventory: {
              select: {
                id: true,
                name: true,
                type: true,
                quantity: true,
                properties: true,
              },
            },
          },
        },
      },
    }),

    // Pillar 2: active encounter with combatants (null if none)
    prisma.encounter.findFirst({
      where: { campaignId, status: "active" },
      select: {
        id: true,
        round: true,
        currentTurnIndex: true,
        zones: true,
        combatants: {
          select: {
            id: true,
            name: true,
            isPlayer: true,
            hp: true,
            maxHp: true,
            initiativeTotal: true,
            conditions: true,
            currentZoneId: true,
          },
          orderBy: { initiativeTotal: "desc" },
        },
      },
    }),

    // Pillar 3: last 5 logs fetched desc, reversed to chronological order below
    prisma.gameLog.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    }),
  ]);

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  return {
    character: campaign.character,
    activeEncounter: activeEncounter ?? null,
    // Reverse so logs are oldest-first (natural reading order for AI context)
    recentLogs: recentLogsDesc.reverse(),
  };
}
