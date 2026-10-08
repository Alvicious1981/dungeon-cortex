import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { characterSheetErrorResponse } from "@/lib/character-sheet/http";
import { getCharacterSheet } from "@/lib/character-sheet/service";
import { exportCharacterPdf } from "@/lib/character-sheet/pdf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id }, user] = await Promise.all([params, getAuthUser()]);
    const { sheet, character, profile } = await getCharacterSheet({
      characterId: id,
      userId: user.id,
    });
    const bytes = await exportCharacterPdf(sheet, {
      id: character.id,
      name: character.name,
      revision: character.revision,
      updatedAt: character.updatedAt.toISOString(),
      appearance: profile.appearance,
      backstory: profile.backstory,
      personalityTraits: profile.personalityTraits,
      ideals: profile.ideals,
      bonds: profile.bonds,
      flaws: profile.flaws,
    });
    const filename = `${character.name.replace(/[^A-Za-z0-9_-]+/g, "-") || "personaje"}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return characterSheetErrorResponse(error);
  }
}
