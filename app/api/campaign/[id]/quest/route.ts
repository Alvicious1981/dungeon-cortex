import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function validateCampaignOwnership(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { userId: true, status: true },
  });
  if (!campaign) return { error: "Campaign not found.", status: 404 } as const;
  if (campaign.userId !== userId) return { error: "Campaign does not belong to this user.", status: 403 } as const;
  if (campaign.status !== "active") return { error: "Campaign is not active.", status: 409 } as const;
  return null;
}

/**
 * POST /api/campaign/[id]/quest
 * Body: { title: string; description: string }
 * Creates a new active quest for the campaign.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: { title?: unknown; description?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title is required (non-empty string)." }, { status: 400 });
  }
  if (typeof body.description !== "string" || !body.description.trim()) {
    return NextResponse.json({ error: "description is required (non-empty string)." }, { status: 400 });
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
  const err = await validateCampaignOwnership(campaignId, user.id);
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });

  const quest = await prisma.quest.create({
    data: {
      campaignId,
      title: body.title.trim(),
      description: body.description.trim(),
      status: "active",
    },
  });

  return NextResponse.json(quest, { status: 201 });
}

/**
 * GET /api/campaign/[id]/quest
 * Query params: ?status=active|completed|failed  (default: all)
 * Returns all quests for the campaign, newest-first.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let user;
  try {
    user = await getAuthUser();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }
  const err = await validateCampaignOwnership(campaignId, user.id);
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });

  const statusFilter = req.nextUrl.searchParams.get("status");
  const validStatuses = ["active", "completed", "failed"];

  const quests = await prisma.quest.findMany({
    where: {
      campaignId,
      ...(statusFilter && validStatuses.includes(statusFilter)
        ? { status: statusFilter }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(quests);
}
