import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { characterAliveRefusal, guardResponse } from "@/lib/db/campaign-guard";
import { buildMainPartyMemberData } from "@/lib/party/roster";

interface CreateCampaignBody {
  characterId: string;
  title: string;
}

export async function POST(req: NextRequest) {
  let body: CreateCampaignBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { characterId, title } = body;

  if (!characterId?.trim()) {
    return NextResponse.json({ error: "characterId is required." }, { status: 400 });
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
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

  // Validate character exists and belongs to this user
  const character = await prisma.character.findUnique({
    where: { id: characterId.trim() },
  });

  if (!character) {
    return NextResponse.json({ error: "Character not found." }, { status: 404 });
  }
  if (character.userId !== user.id) {
    return NextResponse.json({ error: "Character does not belong to this user." }, { status: 403 });
  }
  // A dead character cannot start another campaign (death-saves spec §9).
  const alive = await characterAliveRefusal(prisma, character.id);
  if (alive) return guardResponse(alive);

  // DC-PARTY-001: every Campaign gets a MAIN PartyMember row for its main
  // Character, created atomically with the Campaign so "this Campaign has a
  // Party" holds from the moment the Campaign exists, not just for
  // backfilled historical data (see docs/PARTY_AND_COMPANIONS.md). This
  // does not change Campaign.characterId's meaning or this route's response
  // shape — it only adds a normalized mirror of the same fact.
  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        userId: user.id,
        characterId: character.id,
        title: title.trim(),
        status: "active",
      },
    });
    await tx.partyMember.create({
      data: buildMainPartyMemberData(created.id, character.id),
    });
    return created;
  });

  return NextResponse.json({ id: campaign.id }, { status: 201 });
}
