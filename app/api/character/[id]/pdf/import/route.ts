import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth/session";
import { importCharacterProfileFromPdf } from "@/lib/character-sheet/pdf";
import { characterSheetErrorResponse } from "@/lib/character-sheet/http";
import { createCharacterProposal } from "@/lib/character-sheet/service";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

const metadataSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id }, user, form] = await Promise.all([params, getAuthUser(), request.formData()]);
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Debes adjuntar un archivo PDF." }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "El PDF supera el límite de 10 MB." }, { status: 413 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "El archivo debe ser de tipo PDF." }, { status: 415 });
    }
    const metadata = metadataSchema.parse({
      expectedVersion: form.get("expectedVersion"),
      idempotencyKey: form.get("idempotencyKey"),
    });
    let imported;
    try {
      imported = await importCharacterProfileFromPdf(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "No se pudo leer el PDF." },
        { status: 422 }
      );
    }
    if (imported.changes.length === 0) {
      return NextResponse.json(
        { error: "El PDF no contiene campos narrativos importables con contenido." },
        { status: 422 }
      );
    }
    const result = await createCharacterProposal({
      characterId: id,
      userId: user.id,
      expectedVersion: metadata.expectedVersion,
      idempotencyKey: metadata.idempotencyKey,
      changes: imported.changes,
      reason: `Vista previa importada desde ${file.name.slice(0, 180)}`,
      warnings: imported.warnings,
      source: "PDF_IMPORT",
    });
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return characterSheetErrorResponse(error);
  }
}
