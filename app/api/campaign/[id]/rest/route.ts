import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { resolveRest, RestServiceError } from "@/lib/rules/rest-service";

interface RestBody {
  type: "long" | "short";
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/campaign/[id]/rest
 *
 * Body: { type: "long" | "short" }
 *
 * The route owns HTTP concerns: parsing, auth, ownership, and response shape.
 * Rest mechanics and character persistence are delegated to rest-service.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: RestBody;
  try {
    const raw = await req.json();
    if (raw?.type !== "long" && raw?.type !== "short") {
      return NextResponse.json(
        { error: "type must be \"long\" or \"short\"." },
        { status: 400 }
      );
    }
    body = raw as RestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
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
    select: { id: true, userId: true, characterId: true, status: true },
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
    const result = await resolveRest({
      campaignId,
      characterId: campaign.characterId,
      restType: body.type,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof RestServiceError) {
      const status =
        error.code === "CAMPAIGN_NOT_FOUND" || error.code === "CHARACTER_NOT_FOUND"
          ? 404
          : error.code === "INVALID_REST_TYPE" || error.code === "INVALID_HIT_DICE"
            ? 400
            : 409;

      return NextResponse.json({ error: error.message }, { status });
    }

    throw error;
  }
}
