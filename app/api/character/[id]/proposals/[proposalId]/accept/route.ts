import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { characterAliveRefusal, guardResponse } from "@/lib/db/campaign-guard";
import { characterProposalDecisionSchema } from "@/lib/character-sheet/contracts";
import { characterSheetErrorResponse } from "@/lib/character-sheet/http";
import { acceptCharacterProposal } from "@/lib/character-sheet/service";

interface RouteContext {
  params: Promise<{ id: string; proposalId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id, proposalId }, user, body] = await Promise.all([params, getAuthUser(), request.json()]);
    const alive = await characterAliveRefusal(prisma, id, user.id);
    if (alive) return guardResponse(alive);
    const parsed = characterProposalDecisionSchema.parse(body);
    return NextResponse.json(
      await acceptCharacterProposal({
        characterId: id,
        proposalId,
        userId: user.id,
        idempotencyKey: parsed.idempotencyKey,
      })
    );
  } catch (error) {
    return characterSheetErrorResponse(error);
  }
}
