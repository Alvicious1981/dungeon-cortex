import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDevUser } from "@/lib/db/dev-user";
import { isSpellSlots, hasAvailableSlot, consumeSlot } from "@/lib/rules/magic";
import type { Prisma } from "@/app/generated/prisma/client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RequestBody {
  spellLevel: number;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { spellLevel } = body;

  if (typeof spellLevel !== "number" || !Number.isInteger(spellLevel) || spellLevel < 1 || spellLevel > 9) {
    return NextResponse.json(
      { error: "spellLevel must be an integer between 1 and 9." },
      { status: 400 }
    );
  }

  const user = await ensureDevUser();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      userId: true,
      character: { select: { id: true, spellSlots: true } },
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

  const { character } = campaign;
  const rawSlots = character.spellSlots;

  if (!isSpellSlots(rawSlots)) {
    return NextResponse.json(
      { error: "This character has no spellcasting ability." },
      { status: 400 }
    );
  }

  if (!hasAvailableSlot(rawSlots, spellLevel)) {
    return NextResponse.json(
      { error: `No available spell slots remaining at level ${spellLevel}.` },
      { status: 400 }
    );
  }

  const updatedSlots = consumeSlot(rawSlots, spellLevel);

  const updatedCharacter = await prisma.character.update({
    where: { id: character.id },
    data: { spellSlots: updatedSlots as unknown as Prisma.InputJsonValue },
    select: { spellSlots: true },
  });

  return NextResponse.json({ spellSlots: updatedCharacter.spellSlots }, { status: 200 });
}
