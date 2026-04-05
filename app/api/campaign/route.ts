import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDevUser } from "@/lib/db/dev-user";

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

  const user = await ensureDevUser();

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

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      characterId: character.id,
      title: title.trim(),
      status: "active",
    },
  });

  return NextResponse.json({ id: campaign.id }, { status: 201 });
}
