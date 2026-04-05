import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDevUser } from "@/lib/db/dev-user";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  const user = await ensureDevUser();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { userId: true, characterId: true },
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

  const items = await prisma.inventoryItem.findMany({
    where: { characterId: campaign.characterId },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(items, { status: 200 });
}
