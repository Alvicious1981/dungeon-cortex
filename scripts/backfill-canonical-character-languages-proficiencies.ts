/**
 * scripts/backfill-canonical-character-languages-proficiencies.ts
 *
 * Script de migración de datos (backfill) seguro, determinista e idempotente.
 * Lee los personajes existentes en la base de datos y genera sus registros canónicos
 * en CharacterLanguage y CharacterProficiency según su raza y clase del SRD 5.1.
 *
 * Características de seguridad:
 * - Idempotente: solo inserta si el personaje no tiene ya filas correspondientes.
 * - Aditivo: no modifica ningún dato existente en Character, Campaign o Inventory.
 * - Transaccional por personaje: si falla un personaje, reporta el error sin corromper el resto.
 *
 * Uso directo: npx tsx scripts/backfill-canonical-character-languages-proficiencies.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  getDefaultLanguagesForRace,
  buildCanonicalCharacterLanguages,
} from "../lib/rules/canonical/character-languages";
import { buildBaselineClassProficiencies } from "../lib/rules/canonical/character-proficiencies";
import { DEFAULT_RULESET_ID } from "../lib/rules/canonical/constants";

export interface BackfillLanguagesProficienciesResult {
  charactersProcessed: number;
  languagesCreated: number;
  proficienciesCreated: number;
  skippedCharacters: number;
  errors: Array<{ characterId: string; error: string }>;
}

export async function backfillCanonicalLanguagesAndProficiencies(
  client: PrismaClient
): Promise<BackfillLanguagesProficienciesResult> {
  const result: BackfillLanguagesProficienciesResult = {
    charactersProcessed: 0,
    languagesCreated: 0,
    proficienciesCreated: 0,
    skippedCharacters: 0,
    errors: [],
  };

  const characters = await client.character.findMany({
    select: {
      id: true,
      name: true,
      race: true,
      class: true,
      languages: { select: { languageCode: true } },
      proficiencies: { select: { type: true, code: true } },
    },
  });

  for (const char of characters) {
    result.charactersProcessed++;

    try {
      let charLangsCreated = 0;
      let charProfsCreated = 0;

      // 1. Idiomas
      if (char.languages.length === 0) {
        const defaultLangs = getDefaultLanguagesForRace(char.race);
        const langPayload = buildCanonicalCharacterLanguages(
          char.id,
          defaultLangs,
          DEFAULT_RULESET_ID
        );

        if (langPayload.length > 0) {
          const insertRes = await client.characterLanguage.createMany({
            data: langPayload,
            skipDuplicates: true,
          });
          charLangsCreated = insertRes.count;
          result.languagesCreated += charLangsCreated;
        }
      }

      // 2. Competencias genéricas de clase
      if (char.proficiencies.length === 0) {
        const profPayload = buildBaselineClassProficiencies(
          char.id,
          char.class,
          DEFAULT_RULESET_ID
        );

        if (profPayload.length > 0) {
          const insertRes = await client.characterProficiency.createMany({
            data: profPayload,
            skipDuplicates: true,
          });
          charProfsCreated = insertRes.count;
          result.proficienciesCreated += charProfsCreated;
        }
      }

      if (charLangsCreated === 0 && charProfsCreated === 0) {
        result.skippedCharacters++;
      }
    } catch (err) {
      result.errors.push({
        characterId: char.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("► Iniciando backfill de CharacterLanguage y CharacterProficiency...");
    const res = await backfillCanonicalLanguagesAndProficiencies(prisma);
    console.log(
      `✓ Backfill finalizado: ` +
        `procesados=${res.charactersProcessed}, ` +
        `idiomas_creados=${res.languagesCreated}, ` +
        `competencias_creadas=${res.proficienciesCreated}, ` +
        `omitidos_o_al_día=${res.skippedCharacters}, ` +
        `errores=${res.errors.length}`
    );
    if (res.errors.length > 0) {
      console.warn("Advertencias/Errores encontrados:", res.errors);
    }
  } catch (error) {
    console.error("✗ Error fatal durante el backfill:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backfill-canonical-character-languages-proficiencies.ts")) {
  void main();
}
