import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/campaign/[id]/memories
 *
 * Returns the most recent consolidated MemoryEntry rows for a campaign,
 * ordered newest-first. Excludes the `embedding` vector column — it is an
 * Unsupported type in Prisma and must never appear in a regular select.
 *
 * Query params:
 *   ?limit=N  — max entries to return (default 20, max 50)
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(50, Math.max(1, rawLimit ? parseInt(rawLimit, 10) || 20 : 20));

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
    select: { userId: true },
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

  // Explicit select is required — the embedding column is Unsupported("vector(1536)")
  // and must not be included in any regular Prisma query.
  const memories = await prisma.memoryEntry.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      content: true,
      importance: true,
      createdAt: true,
    },
  });

  return NextResponse.json(memories);
}
