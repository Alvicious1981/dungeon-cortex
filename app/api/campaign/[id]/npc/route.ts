import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { generateNPC } from "@/lib/rules/npc";
import type { NPCRole } from "@/lib/rules/npc";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const VALID_ROLES: NPCRole[] = ["guard", "bandit", "commoner"];

/**
 * POST /api/campaign/[id]/npc
 *
 * UPSERT an NPC record for the campaign.
 *
 * Body:
 *   seed  {string} — stable generator seed (e.g. "town_guard_north_gate")
 *   role  {"guard"|"bandit"|"commoner"}
 *   notes {string?} — DM narrative notes (merged on update, replaced on create)
 *   hp    {number?} — override current HP (e.g. after damage is applied)
 *
 * Behaviour:
 *   - If no NPC with (campaignId, seed) exists → create, deriving name/hp/maxHp/ac
 *     from the deterministic generateNPC(seed, role) statblock.
 *   - If already exists → update only the supplied mutable fields (notes, hp).
 *     The seed, role, name, maxHp, ac are immutable after creation.
 *
 * "Code is Law":
 *   The statblock values (maxHp, ac) are derived server-side from the
 *   deterministic rules engine, never trusted from the request body.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: { seed?: unknown; role?: unknown; notes?: unknown; hp?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.seed || typeof body.seed !== "string" || body.seed.trim().length === 0) {
    return NextResponse.json(
      { error: "seed must be a non-empty string." },
      { status: 400 }
    );
  }
  if (!body.role || !VALID_ROLES.includes(body.role as NPCRole)) {
    return NextResponse.json(
      { error: `role must be one of: ${VALID_ROLES.join(", ")}.` },
      { status: 400 }
    );
  }

  const seed = body.seed.trim();
  const role = body.role as NPCRole;
  const notes = typeof body.notes === "string" ? body.notes : undefined;
  const hpOverride =
    typeof body.hp === "number" && Number.isFinite(body.hp) ? Math.max(0, body.hp) : undefined;

  // Verify the campaign belongs to the authenticated dev user.
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

  // Derive the statblock deterministically — values are never trusted from the client.
  const statblock = generateNPC(seed, role);

  const npc = await prisma.nPC.upsert({
    where: { campaignId_seed: { campaignId, seed } },
    create: {
      campaignId,
      seed,
      role,
      name: statblock.name,
      maxHp: statblock.maxHp,
      hp: hpOverride ?? statblock.hp,
      ac: statblock.ac,
      notes: notes ?? "",
    },
    update: {
      ...(notes !== undefined && { notes }),
      ...(hpOverride !== undefined && { hp: hpOverride }),
    },
  });

  return NextResponse.json(npc, { status: 200 });
}
