import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import {
  applyLevelUp,
  LevelUpServiceError,
  type LevelUpServiceErrorCode,
} from "@/lib/rules/level-up-service";
import { LevelUpPayloadSchema } from "@/lib/rules/progression";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * `.strict()` is the point of this schema: an unexpected key is a rejected
 * request, not a silently dropped one. A client trying to smuggle
 * characterId, targetLevel, source, or any other authority field gets a 400.
 */
const levelUpRequestSchema = z
  .object({
    useAverage: z.boolean(),
  })
  .strict();

/** Fixed by code. The request body can never influence the audit trail. */
const LEVEL_UP_SOURCE = "level_up_route";

const STATUS_BY_CODE: Record<LevelUpServiceErrorCode, number> = {
  // The campaign resolved but its character did not: not accessible.
  CAMPAIGN_NOT_FOUND: 404,
  CHARACTER_NOT_FOUND: 404,
  // Persisted progression state is self-contradictory.
  INVALID_CHARACTER_XP: 422,
  INVALID_CHARACTER_LEVEL: 422,
  INVALID_CHARACTER_CLASS: 422,
  // There is no single pending level-up to apply right now.
  INVALID_LEVEL_UP_STATE: 409,
  INVALID_LEVEL_JUMP: 409,
  LEVEL_UP_ALREADY_APPLIED: 409,
};

/** Stable, non-revealing messages. Service text may name ids or internals. */
const MESSAGE_BY_CODE: Record<LevelUpServiceErrorCode, string> = {
  CAMPAIGN_NOT_FOUND: "Campaign not found.",
  CHARACTER_NOT_FOUND: "Campaign not found.",
  INVALID_CHARACTER_XP: "The stored progression state is inconsistent.",
  INVALID_CHARACTER_LEVEL: "The stored progression state is inconsistent.",
  INVALID_CHARACTER_CLASS: "The stored progression state is inconsistent.",
  INVALID_LEVEL_UP_STATE: "There is no pending level-up to apply.",
  INVALID_LEVEL_JUMP: "This level-up cannot be applied in a single step.",
  LEVEL_UP_ALREADY_APPLIED: "The level-up was already applied.",
};

/**
 * POST /api/campaign/[id]/level-up
 *
 * Applies exactly one pending level-up. This route owns HTTP concerns only:
 * parsing, auth, ownership, and response shape. All XP, hit-die, and
 * hit-point arithmetic — and the persistence transaction — are delegated to
 * `applyLevelUp` (Model E). The client contributes exactly one bit
 * (`useAverage`); everything else is derived server-side.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = levelUpRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", code: "INVALID_BODY" },
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

  // Ownership and character identity in one query. A campaign that does not
  // exist and one that belongs to somebody else produce the same 404, so the
  // response never reveals which.
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId: user.id },
    select: { id: true, characterId: true },
  });

  if (!campaign?.characterId) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  try {
    const result = await applyLevelUp({
      campaignId: campaign.id,
      characterId: campaign.characterId,
      useAverage: parsed.data.useAverage,
      source: LEVEL_UP_SOURCE,
    });

    // Strip the service-only bookkeeping (XP, previous hit points, facts) so
    // the wire carries exactly the applied-level-up contract and nothing more.
    return NextResponse.json({ payload: LevelUpPayloadSchema.parse(result) }, { status: 200 });
  } catch (error) {
    if (error instanceof LevelUpServiceError) {
      return NextResponse.json(
        { error: MESSAGE_BY_CODE[error.code], code: error.code },
        { status: STATUS_BY_CODE[error.code] }
      );
    }

    console.error("[level-up] Failed to apply level-up:", error);
    return NextResponse.json({ error: "Could not apply the level-up." }, { status: 500 });
  }
}
