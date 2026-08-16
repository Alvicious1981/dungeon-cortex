import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { characterSheetErrorResponse } from "@/lib/character-sheet/http";
import { listCharacterHistory } from "@/lib/character-sheet/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id }, user] = await Promise.all([params, getAuthUser()]);
    return NextResponse.json(await listCharacterHistory(id, user.id));
  } catch (error) {
    return characterSheetErrorResponse(error);
  }
}
