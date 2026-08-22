import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { characterSheetErrorResponse } from "@/lib/character-sheet/http";
import { CharacterSheetServiceError } from "@/lib/character-sheet/service";
import { buildSheetViewModel } from "@/lib/character-sheet/view-model";
import { exportCharacterPdf } from "@/lib/character-sheet/pdf";
import { resolveInventoryWeaponProfiles } from "@/lib/rules/weapon-profile-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const [{ id }, user] = await Promise.all([params, getAuthUser()]);
    const character = await prisma.character.findFirst({
      where: { id, userId: user.id },
      include: {
        profile: true,
        inventory: { orderBy: [{ type: "asc" }, { name: "asc" }] },
      },
    });
    if (!character) {
      throw new CharacterSheetServiceError("CHARACTER_NOT_FOUND", "Personaje no encontrado.");
    }
    // Same resolution the campaign page and the attack sites perform: the
    // exported sheet must not print a bonus the die will not roll.
    const weaponProfiles = await resolveInventoryWeaponProfiles(character.inventory);
    const sheet = buildSheetViewModel({
      character,
      inventory: character.inventory,
      weaponProfiles,
    });
    const bytes = await exportCharacterPdf(sheet, {
      id: character.id,
      name: character.name,
      revision: character.revision,
      updatedAt: character.updatedAt.toISOString(),
      appearance: character.profile?.appearance ?? "",
      backstory: character.profile?.backstory ?? "",
      personalityTraits: character.profile?.personalityTraits ?? "",
      ideals: character.profile?.ideals ?? "",
      bonds: character.profile?.bonds ?? "",
      flaws: character.profile?.flaws ?? "",
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
