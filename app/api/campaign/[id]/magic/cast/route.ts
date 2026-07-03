import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { castSpell, MagicServiceError } from "@/lib/rules/magic-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RequestBody {
  spellLevel: number;
  spellId?: string;
  slotLevel?: number;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { spellId, spellLevel, slotLevel } = body;

  if (typeof spellLevel !== "number" || !Number.isInteger(spellLevel) || spellLevel < 1 || spellLevel > 9) {
    return NextResponse.json(
      { error: "spellLevel must be an integer between 1 and 9." },
      { status: 400 }
    );
  }

  if (
    slotLevel !== undefined &&
    (typeof slotLevel !== "number" || !Number.isInteger(slotLevel) || slotLevel < 1 || slotLevel > 9)
  ) {
    return NextResponse.json(
      { error: "slotLevel must be an integer between 1 and 9." },
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
    select: {
      userId: true,
      character: { select: { id: true } },
    },
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

  try {
    const result = await castSpell({
      campaignId,
      characterId: campaign.character.id,
      spellId,
      spellLevel,
      slotLevel,
      db: prisma,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof MagicServiceError) {
      const status =
        error.code === "CAMPAIGN_NOT_FOUND" || error.code === "CHARACTER_NOT_FOUND"
          ? 404
          : 400;

      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    throw error;
  }
}