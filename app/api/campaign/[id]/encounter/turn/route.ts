import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDevUser } from "@/lib/db/dev-user";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  const user = await ensureDevUser();

  // Validate campaign ownership
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (campaign.userId !== user.id) {
    return NextResponse.json(
      { error: "Campaign does not belong to this user." },
      { status: 403 }
    );
  }

  // Find the single active encounter with its combatants ordered by initiative
  const encounter = await prisma.encounter.findFirst({
    where: { campaignId, status: "active" },
    include: {
      combatants: {
        orderBy: { initiativeTotal: "desc" },
      },
    },
  });

  if (!encounter) {
    return NextResponse.json(
      { error: "No active encounter found for this campaign." },
      { status: 404 }
    );
  }

  const totalCombatants = encounter.combatants.length;

  // Guard against a degenerate encounter with no combatants
  if (totalCombatants === 0) {
    return NextResponse.json(
      { error: "Encounter has no combatants." },
      { status: 409 }
    );
  }

  const nextIndex = encounter.currentTurnIndex + 1;
  const isNewRound = nextIndex >= totalCombatants;

  const newTurnIndex = isNewRound ? 0 : nextIndex;
  const newRound = isNewRound ? encounter.round + 1 : encounter.round;

  // Persist the updated turn state
  const updated = await prisma.encounter.update({
    where: { id: encounter.id },
    data: {
      currentTurnIndex: newTurnIndex,
      round: newRound,
    },
    include: {
      combatants: {
        orderBy: { initiativeTotal: "desc" },
      },
    },
  });

  return NextResponse.json(
    {
      encounterId: updated.id,
      round: updated.round,
      currentTurnIndex: updated.currentTurnIndex,
      activeCombatant: updated.combatants[updated.currentTurnIndex] ?? null,
      isNewRound,
    },
    { status: 200 }
  );
}
