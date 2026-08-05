import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { characterUndoRequestSchema } from "@/lib/character-sheet/contracts";
import { characterSheetErrorResponse } from "@/lib/character-sheet/http";
import { undoCharacterChange } from "@/lib/character-sheet/service";

interface RouteContext {
  params: Promise<{ id: string; auditId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id, auditId }, user, body] = await Promise.all([params, getAuthUser(), request.json()]);
    const parsed = characterUndoRequestSchema.parse(body);
    return NextResponse.json(
      await undoCharacterChange({
        characterId: id,
        auditId,
        userId: user.id,
        expectedVersion: parsed.expectedVersion,
        idempotencyKey: parsed.idempotencyKey,
      })
    );
  } catch (error) {
    return characterSheetErrorResponse(error);
  }
}
