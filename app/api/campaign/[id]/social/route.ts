import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { resolveSocialCheck, SocialServiceError } from "@/lib/rules/social-service";
import { initialAttitudeFor, INITIAL_DISPOSITION } from "@/lib/rules/social-logic";
import type { NPCRole } from "@/lib/rules/npc";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const BodySchema = z
  .object({
    npcId: z.string().min(1).max(200),
    approach: z.enum(["persuade", "intimidate", "deceive"]),
    intent: z.string().max(200),
  })
  .strict();

/**
 * POST /api/campaign/[id]/social
 *
 * Resolves one attempt to talk an NPC round.
 *
 * The client sends who, which approach, and what it wants. It never sends a
 * roll, a DC or a disposition: those are the backend's, and `resolveSocialCheck`
 * settles them and persists the result in one transaction.
 *
 * First contact is established here rather than refused. The roster lists every
 * NPC, so a player can click one the party has never spoken to; the opening
 * attitude comes from that NPC's own seed, the same way the rest of them is
 * derived, and never from who happens to be doing the talking.
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
    return NextResponse.json({ error: "Invalid social action." }, { status: 400 });
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
    return NextResponse.json({ error: "Campaign does not belong to this user." }, { status: 403 });
  }
  if (campaign.status !== "active") {
    return NextResponse.json({ error: "Campaign is not active." }, { status: 409 });
  }

  const npc = await prisma.nPC.findUnique({
    where: { id: parsed.data.npcId },
    select: { id: true, campaignId: true, seed: true, role: true, hasMetPlayer: true },
  });
  if (!npc || npc.campaignId !== campaignId) {
    return NextResponse.json({ error: "NPC not found." }, { status: 404 });
  }

  if (!npc.hasMetPlayer) {
    const attitude = initialAttitudeFor(npc.seed, npc.role as NPCRole);
    await prisma.nPC.update({
      where: { id: npc.id },
      data: { disposition: INITIAL_DISPOSITION[attitude], hasMetPlayer: true },
    });
  }

  try {
    const result = await resolveSocialCheck({
      campaignId,
      npcId: npc.id,
      approach: parsed.data.approach,
      intent: parsed.data.intent,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SocialServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
