import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import {
  QuestServiceError,
  VALID_QUEST_STATUSES,
  updateQuestStatus,
  type QuestStatus,
} from "@/lib/rules/quest-service";

interface RouteContext {
  params: Promise<{ id: string; questId: string }>;
}

/**
 * PATCH /api/campaign/[id]/quest/[questId]
 * Body: { status: "active" | "completed" | "failed" }
 *
 * Updates the quest status. Enforces ownership before delegating mutation to
 * the backend quest service.
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId, questId } = await params;

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.status || !VALID_QUEST_STATUSES.includes(body.status as QuestStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_QUEST_STATUSES.join(", ")}.` },
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

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { userId: true, status: true },
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
  if (campaign.status !== "active") {
    return NextResponse.json({ error: "Campaign is not active." }, { status: 409 });
  }

  try {
    const result = await updateQuestStatus({
      campaignId,
      questId,
      status: body.status as QuestStatus,
      reason: "api_quest_patch",
    });

    return NextResponse.json(result.quest);
  } catch (e) {
    if (e instanceof QuestServiceError) {
      const status = e.code === "INVALID_QUEST_STATUS" ? 400 : 404;
      return NextResponse.json({ error: e.message }, { status });
    }
    throw e;
  }
}