import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, getAuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  completeSession,
  pauseSession,
  resumeSession,
  SessionLifecycleError,
} from "@/lib/db/session-lifecycle";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const SessionCommandSchema = z.object({
  action: z.enum(["pause", "resume", "complete"]),
}).strict();

async function authorizeCampaign(campaignId: string) {
  const user = await getAuthUser();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, userId: true },
  });
  if (!campaign) {
    return { error: NextResponse.json({ error: "Campaign not found." }, { status: 404 }) };
  }
  if (campaign.userId !== user.id) {
    return { error: NextResponse.json({ error: "Campaign does not belong to this user." }, { status: 403 }) };
  }
  return { campaign };
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;
  try {
    const auth = await authorizeCampaign(campaignId);
    if (auth.error) return auth.error;
    const session = await prisma.gameSession.findFirst({
      where: { campaignId },
      orderBy: { sessionNumber: "desc" },
      select: {
        id: true,
        sessionNumber: true,
        status: true,
        mode: true,
        sceneNumber: true,
        sceneTitle: true,
        summary: true,
        startedAt: true,
        pausedAt: true,
        endedAt: true,
      },
    });
    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;
  try {
    const auth = await authorizeCampaign(campaignId);
    if (auth.error) return auth.error;
    const parsed = SessionCommandSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid session command." }, { status: 400 });
    }

    const session = parsed.data.action === "pause"
      ? await pauseSession(campaignId)
      : parsed.data.action === "resume"
        ? await resumeSession(campaignId)
        : await completeSession(campaignId);

    return NextResponse.json({
      session: {
        id: session.id,
        sessionNumber: session.sessionNumber,
        status: session.status,
        mode: session.mode,
        summary: session.summary,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SessionLifecycleError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }
}
