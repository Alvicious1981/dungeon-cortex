import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { characterAliveRefusal, guardResponse } from "@/lib/db/campaign-guard";
import { characterEditRequestSchema } from "@/lib/character-sheet/contracts";
import { characterSheetErrorResponse } from "@/lib/character-sheet/http";
import { editCharacter, getCharacterEditableSnapshot } from "@/lib/character-sheet/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id }, user] = await Promise.all([params, getAuthUser()]);
    return NextResponse.json(await getCharacterEditableSnapshot(id, user.id));
  } catch (error) {
    return characterSheetErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id }, user, body] = await Promise.all([params, getAuthUser(), request.json()]);
    // A dead character is refused whatever the body (death-saves spec §9).
    const alive = await characterAliveRefusal(prisma, id, user.id);
    if (alive) return guardResponse(alive);
    const parsed = characterEditRequestSchema.parse(body);
    const result = await editCharacter({
      characterId: id,
      userId: user.id,
      ...parsed,
    });
    return NextResponse.json(result);
  } catch (error) {
    return characterSheetErrorResponse(error);
  }
}
