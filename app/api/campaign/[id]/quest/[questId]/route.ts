import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";

interface RouteContext {
  params: Promise<{ id: string; questId: string }>;
}

const VALID_STATUSES = ["active", "completed", "failed"] as const;
type QuestStatus = typeof VALID_STATUSES[number];

/**
 * PATCH /api/campaign/[id]/quest/[questId]
 * Body: { status: "active" | "completed" | "failed" }
 *
 * Updates the quest status. Enforces ownership — the quest must belong to
 * the campaign, which must belong to the dev user.
 *
 * "Code is Law": quest state is mutated here by a deterministic server-side
 * update, never by AI narration alone.
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId, questId } = await params;

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.status || !VALID_STATUSES.includes(body.status as QuestStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  // Verify campaign ownership and that the quest belongs to this campaign
  const quest = await prisma.quest.findUnique({
    where: { id: questId },
    select: {
      id: true,
      status: true,
      campaign: { select: { userId: true, status: true } },
    },
  });

  if (!quest) {
    return NextResponse.json({ error: "Quest not found." }, { status: 404 });
  }
  if (quest.campaign.userId !== user.id) {
    return NextResponse.json(
      { error: "Quest does not belong to this user." },
      { status: 403 }
    );
  }
  if (quest.campaign.status !== "active") {
    return NextResponse.json({ error: "Campaign is not active." }, { status: 409 });
  }
  // Verify quest belongs to the campaign in the URL path
  const questInCampaign = await prisma.quest.findFirst({
    where: { id: questId, campaignId },
  });
  if (!questInCampaign) {
    return NextResponse.json(
      { error: "Quest does not belong to this campaign." },
      { status: 404 }
    );
  }

  const updated = await prisma.quest.update({
    where: { id: questId },
    data: { status: body.status as QuestStatus },
  });

  return NextResponse.json(updated);
}
