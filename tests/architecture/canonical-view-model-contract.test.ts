/**
 * tests/architecture/canonical-view-model-contract.test.ts
 *
 * Contrato arquitectónico para la proyección y servicio unificado de ficha de personaje (Fase 8).
 * 1. lib/character-sheet/view-model.ts debe ser una función pura sin efectos secundarios ni acceso a base de datos.
 * 2. lib/character-sheet/service.ts exporta getCharacterSheet con inclusión completa de relaciones canónicas.
 * 3. app/api/character/[id]/pdf/route.ts delega en getCharacterSheet sin duplicar consultas directas a Prisma.
 * 4. app/campaign/[id]/page.tsx incluye las colecciones canónicas en el include de campaign.character.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

describe("Contrato Arquitectónico: View-Model y Servicio de Ficha (Fase 8)", () => {
  it("garantiza que lib/character-sheet/view-model.ts es una función pura sin dependencias de base de datos", () => {
    const source = readFileSync(
      join(ROOT, "lib", "character-sheet", "view-model.ts"),
      "utf8"
    );

    // No debe importar Prisma ni conectores de base de datos
    expect(source).not.toMatch(/@\/lib\/db\/prisma/);
    expect(source).not.toMatch(/@prisma\/client/);
    expect(source).not.toMatch(/findUnique|findFirst|findMany/);
  });

  it("garantiza que lib/character-sheet/service.ts exporta getCharacterSheet con inclusión canónica completa", () => {
    const source = readFileSync(
      join(ROOT, "lib", "character-sheet", "service.ts"),
      "utf8"
    );

    expect(source).toMatch(/export async function getCharacterSheet\(/);
    // Debe incluir colecciones canónicas
    expect(source).toMatch(/abilities:\s*true/);
    expect(source).toMatch(/skills:\s*true/);
    expect(source).toMatch(/languages:\s*true/);
    expect(source).toMatch(/proficiencies:\s*true/);
    expect(source).toMatch(/classLevels:\s*true/);
    expect(source).toMatch(/origin:\s*\{[\s\S]*?include:\s*\{[\s\S]*?race:\s*true/);
    expect(source).toMatch(/features:\s*\{[\s\S]*?include:\s*\{[\s\S]*?feature:\s*true/);
    expect(source).toMatch(/feats:\s*\{[\s\S]*?include:\s*\{[\s\S]*?feat:\s*true/);
    expect(source).toMatch(/spellSlotRecords:\s*true/);
    expect(source).toMatch(/spells:\s*true/);
  });

  it("garantiza que app/api/character/[id]/pdf/route.ts delega en getCharacterSheet", () => {
    const source = readFileSync(
      join(ROOT, "app", "api", "character", "[id]", "pdf", "route.ts"),
      "utf8"
    );

    expect(source).toMatch(/import\s*\{[\s\S]*?getCharacterSheet[\s\S]*?\}\s*from\s*["']@\/lib\/character-sheet\/service["']/);
    expect(source).toMatch(/await getCharacterSheet\(\{/);
    // No debe hacer consultas directas duplicadas a prisma.character
    expect(source).not.toMatch(/prisma\.character\.findFirst/);
  });

  it("garantiza que app/campaign/[id]/page.tsx incluye las colecciones canónicas en campaign.character", () => {
    const source = readFileSync(
      join(ROOT, "app", "campaign", "[id]", "page.tsx"),
      "utf8"
    );

    const characterIncludeMatch = source.match(
      /character:\s*\{[\s\S]*?include:\s*\{([\s\S]*?)\n\s{6}\},/
    );
    expect(characterIncludeMatch, "character include block not found in page.tsx").not.toBeNull();

    const includeBody = characterIncludeMatch![1];
    expect(includeBody).toMatch(/abilities:\s*true/);
    expect(includeBody).toMatch(/skills:\s*true/);
    expect(includeBody).toMatch(/languages:\s*true/);
    expect(includeBody).toMatch(/proficiencies:\s*true/);
    expect(includeBody).toMatch(/classLevels:\s*true/);
    expect(includeBody).toMatch(/origin:\s*\{/);
    expect(includeBody).toMatch(/features:\s*\{/);
    expect(includeBody).toMatch(/feats:\s*\{/);
    expect(includeBody).toMatch(/spellSlotRecords:\s*true/);
    expect(includeBody).toMatch(/spells:\s*true/);
  });
});
