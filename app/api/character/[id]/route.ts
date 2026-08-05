import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
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
