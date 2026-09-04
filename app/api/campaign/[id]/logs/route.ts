import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

/**
 * GET /api/campaign/[id]/logs
 *
 * Incremental "load older history" for the Bitácora (DC-AUD-006). The
 * initial page render (DC-AUD-005) only ever shows the 50 most recent
 * GameLog rows; this route serves the rows strictly *before* a caller-held
 * keyset cursor, one bounded page at a time. Never returns the full
 * history, never paginates by `skip`, never a Prisma `cursor`.
 *
 * The cursor is `(before, beforeId)` rather than `before` alone: several
 * GameLog rows can share the same millisecond-precision `createdAt`, and a
 * plain `createdAt <` comparison could then skip or duplicate rows across
 * pages. `id` is unique, so `(createdAt, id)` is a strict total order —
 * this route's WHERE and ORDER BY both use it, matching the same total
 * order the initial page query uses.
 *
 * Query params:
 *   before=<ISO8601>   — required together with beforeId
 *   beforeId=<id>      — required together with before
 *   limit=<1..50>      — optional, default 50
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  const rawBefore = req.nextUrl.searchParams.get("before");
  const beforeId = req.nextUrl.searchParams.get("beforeId");

  if (!rawBefore || !beforeId) {
    return NextResponse.json(
      { error: "Both `before` and `beforeId` are required." },
      { status: 400 }
    );
  }

  const before = new Date(rawBefore);
  if (Number.isNaN(before.getTime())) {
    return NextResponse.json({ error: "`before` is not a valid date." }, { status: 400 });
  }

  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, rawLimit ? parseInt(rawLimit, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT)
  );

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

  // Keyset pagination on the total order (createdAt DESC, id DESC). The
  // cursor carries only that pair — never a capability of its own — and
  // `campaignId` above is already authorized for this user, so a cursor
  // copied from another campaign cannot be used to cross into it: the
  // WHERE below still scopes every row to this campaignId.
  const rows = await prisma.gameLog.findMany({
    where: {
      campaignId,
      OR: [
        { createdAt: { lt: before } },
        { createdAt: before, id: { lt: beforeId } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // Sentinel: ask for one extra row instead of a separate count() to
    // learn hasMore. The sentinel is sliced off below, never returned.
    take: limit + 1,
    select: { id: true, role: true, content: true, createdAt: true },
  });

  const hasMore = rows.length > limit;
  const logs = hasMore ? rows.slice(0, limit) : rows;

  return NextResponse.json({ logs, hasMore });
}
