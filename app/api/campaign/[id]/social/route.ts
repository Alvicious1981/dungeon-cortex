import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { resolveSocialCheck, SocialServiceError } from "@/lib/rules/social-service";
import {
  acquireActionReceipt,
  completeActionReceiptWithResponse,
  rejectActionReceipt,
} from "@/lib/actions/request-receipt";
interface RouteContext {
  params: Promise<{ id: string }>;
}

const BodySchema = z
  .object({
    npcId: z.string().min(1).max(200),
    approach: z.enum(["persuade", "intimidate", "deceive"]),
    intent: z.string().max(200),
    requestId: z.string().min(1).max(128).optional(),
  })
  .strict();

function fingerprintSocialSubmission(input: { npcId: string; approach: "persuade" | "intimidate" | "deceive"; intent: string }): string {
  return createHash("sha256").update(JSON.stringify({ npcId: input.npcId, approach: input.approach, intent: input.intent })).digest("hex");
}

/**
 * POST /api/campaign/[id]/social
 *
 * Resolves one attempt to talk an NPC round.
 *
 * The client sends who, which approach, and what it wants. It never sends a
 * roll, a DC or a disposition: those are the backend's, and `resolveSocialCheck`
 * settles them and persists the result in one transaction.
 *
 * First contact is established inside `resolveSocialCheck`'s transaction so
 * initialization and the first disposition shift share one database boundary.
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

  let receiptId: string | undefined;
  if (parsed.data.requestId) {
    const acquisition = await acquireActionReceipt({ actorUserId: user.id, campaignId, requestId: parsed.data.requestId, requestHash: fingerprintSocialSubmission(parsed.data) });
    switch (acquisition.outcome) {
      case "acquired": receiptId = acquisition.receiptId; break;
      case "completed_replay":
      case "rejected": return NextResponse.json(acquisition.responseBody, { status: acquisition.responseStatus });
      case "in_flight": return NextResponse.json({ error: "Social action outcome is not confirmed yet.", code: "SOCIAL_ACTION_IN_FLIGHT" }, { status: 409 });
      case "reused": return NextResponse.json({ error: "This request id already belongs to another social action.", code: "REQUEST_ID_REUSED" }, { status: 409 });
      case "completed_stream": return NextResponse.json({ error: "Invalid social receipt state." }, { status: 500 });
    }
  }

  try {
    const result = await resolveSocialCheck({
      campaignId,
      npcId: npc.id,
      approach: parsed.data.approach,
      intent: parsed.data.intent,
    });
    if (receiptId) await completeActionReceiptWithResponse(receiptId, 200, result);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SocialServiceError) {
      const responseBody = { error: error.message, code: error.code };
      if (receiptId) await rejectActionReceipt(receiptId, 400, responseBody);
      return NextResponse.json(responseBody, { status: 400 });
    }
    throw error;
  }
}
