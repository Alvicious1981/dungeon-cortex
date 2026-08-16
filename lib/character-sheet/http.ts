import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth/session";
import { CharacterSheetServiceError } from "@/lib/character-sheet/service";

const STATUS_BY_CODE: Record<CharacterSheetServiceError["code"], number> = {
  CHARACTER_NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_REUSE: 409,
  NO_CHANGE: 422,
  NAME_LOCKED_DURING_ENCOUNTER: 409,
  PROPOSAL_NOT_FOUND: 404,
  PROPOSAL_NOT_PENDING: 409,
  PROPOSAL_EXPIRED: 410,
  PROPOSAL_INVALID: 422,
  UNDO_NOT_AVAILABLE: 409,
};

export function characterSheetErrorResponse(error: unknown): NextResponse {
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "El cuerpo JSON no es válido." }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Datos de hoja no válidos.", issues: error.issues },
      { status: 400 }
    );
  }
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof CharacterSheetServiceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: STATUS_BY_CODE[error.code] }
    );
  }
  console.error("Character sheet request failed", error);
  return NextResponse.json({ error: "No se pudo procesar la hoja de personaje." }, { status: 500 });
}
