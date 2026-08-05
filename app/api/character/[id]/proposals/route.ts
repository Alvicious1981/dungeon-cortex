import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import {
  characterAiProposalRequestSchema,
  characterChangeSchema,
} from "@/lib/character-sheet/contracts";
import { characterSheetErrorResponse } from "@/lib/character-sheet/http";
import {
  createCharacterProposal,
  getCharacterProposalContext,
  listCharacterProposals,
} from "@/lib/character-sheet/service";
import {
  CharacterProfileAiUnavailableError,
  generateCharacterProfileSuggestion,
} from "@/lib/ai/character-profile-proposal";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id }, user] = await Promise.all([params, getAuthUser()]);
    return NextResponse.json(await listCharacterProposals(id, user.id));
  } catch (error) {
    if (error instanceof CharacterProfileAiUnavailableError) {
      return NextResponse.json({ error: error.message, code: "AI_UNAVAILABLE" }, { status: 503 });
    }
    return characterSheetErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id }, user, body] = await Promise.all([params, getAuthUser(), request.json()]);
    const parsed = characterAiProposalRequestSchema.parse(body);
    const context = await getCharacterProposalContext(id, user.id);
    if (context.snapshot.revision !== parsed.expectedVersion) {
      return NextResponse.json(
        { error: "La hoja cambió antes de solicitar la propuesta.", code: "CONFLICT" },
        { status: 409 }
      );
    }
    const suggestion = await generateCharacterProfileSuggestion({
      field: parsed.field,
      currentValue: context.snapshot[parsed.field],
      instruction: parsed.instruction,
      identity: context.identity,
    });
    const change = characterChangeSchema.parse({ field: parsed.field, value: suggestion.value });
    const result = await createCharacterProposal({
      characterId: id,
      userId: user.id,
      expectedVersion: parsed.expectedVersion,
      idempotencyKey: parsed.idempotencyKey,
      changes: [change],
      reason: suggestion.reason,
      warnings: suggestion.warnings,
      source: "AI_PROPOSAL",
    });
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return characterSheetErrorResponse(error);
  }
}
