import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { resolveRumors, SocialServiceError } from "@/lib/rules/social-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const BodySchema = z
  .object({
    npcId: z.string().min(1).max(200),
  })
  .strict();

/**
 * POST /api/campaign/[id]/social/rumors
 *
 * Asks an NPC what they have heard.
 *
 * Read-only: unlike the social check beside it, nothing here writes. Whether
 * the NPC talks at all is the rules' call, not this route's —
 * `getRumorsPayload` refuses anyone short of Friendly and says why, and that
 * refusal comes back as a 200 with an empty `rumors` array and a
 * `refusalReason`. A refusal is an answer, not an error: the player asked and
 * got told no, which is a fact the UI should show rather than a failure.
 *
 * Auth, ownership and the active-campaign check mirror
 * `app/api/campaign/[id]/social/route.ts` exactly, so the two cannot drift.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rumour request." }, { status: 400 });
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

  const npc = await prisma.nPC.findUnique({
    where: { id: parsed.data.npcId },
    select: { id: true, campaignId: true },
  });
  if (!npc || npc.campaignId !== campaignId) {
    return NextResponse.json({ error: "NPC not found." }, { status: 404 });
  }

  try {
    const payload = await resolveRumors({ campaignId, npcId: npc.id });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof SocialServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
