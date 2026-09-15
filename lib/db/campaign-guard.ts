import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";

export type GuardRefusal = {
  code: "CAMPAIGN_NOT_ACTIVE" | "CHARACTER_DEAD" | "PLAYER_UNCONSCIOUS" | "CHARACTER_AT_ZERO_HP";
  error: string;
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * One refusal for every campaign write route
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §7.2): an inactive
 * campaign, a dead character, or an unconscious player. The action route
 * passes `unconscious: "delegate"` and leaves 0 HP to its own
 * playerConditionRefusal, which lets Death Save and Wait through.
 *
 * Returns null for a missing campaign: every route already answers 404 first.
 * Reduced test doubles may omit the relations; a missing one reads as
 * "alive" / "no active encounter".
 */
export async function campaignPlayableRefusal(
  db: Db,
  campaignId: string,
  options: { unconscious?: "refuse" | "delegate" } = {}
): Promise<GuardRefusal | null> {
  const row = (await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      status: true,
      character: { select: { diedAt: true } },
      encounters: {
        where: { status: "active" },
        select: { combatants: { where: { isPlayer: true }, select: { hp: true } } },
        take: 1,
      },
    },
  })) as {
    status: string;
    character?: { diedAt: Date | null } | null;
    encounters?: Array<{ combatants: Array<{ hp: number }> }>;
  } | null;
  if (!row) return null;

  if (row.character?.diedAt) return { code: "CHARACTER_DEAD", error: "The character is dead." };
  if (row.status !== "active") {
    return { code: "CAMPAIGN_NOT_ACTIVE", error: "Campaign is not active." };
  }
  const player = row.encounters?.[0]?.combatants[0];
  if (options.unconscious !== "delegate" && player && player.hp <= 0) {
    return { code: "PLAYER_UNCONSCIOUS", error: "The player is unconscious." };
  }
  return null;
}

/**
 * Refuses every write to a dead character (death-saves spec §7.2, §9). With a
 * `userId`, a character owned by someone else is not refused here: the route's
 * own ownership check answers 404, so a dead stranger is never revealed.
 */
export async function characterAliveRefusal(
  db: Db,
  characterId: string,
  userId?: string
): Promise<GuardRefusal | null> {
  const row = (await db.character.findUnique({
    where: { id: characterId },
    select: { diedAt: true, userId: true },
  })) as { diedAt: Date | null; userId?: string } | null;
  if (!row?.diedAt) return null;
  if (userId !== undefined && row.userId !== userId) return null;
  return { code: "CHARACTER_DEAD", error: "The character is dead." };
}

export function guardResponse(refusal: GuardRefusal): Response {
  return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: 409 });
}
