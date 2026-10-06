/**
 * scripts/backfill-canonical-character-features.ts
 *
 * Script de migración de datos (backfill) seguro, determinista e idempotente.
 * Lee los personajes existentes en la base de datos y genera sus registros canónicos
 * en CharacterFeature a partir de su clase y nivel acumulado.
 *
 * Características de seguridad:
 * - Idempotente: usa skipDuplicates en inserción masiva por personaje.
 * - Aditivo: no modifica ningún dato existente en Character, Campaign o Inventory.
 * - Transaccional por personaje: si falla un registro, reporta el error sin corromper el resto.
 *
 * Uso directo: npx tsx scripts/backfill-canonical-character-features.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildCanonicalCharacterFeatures } from "../lib/rules/canonical/character-features";

export interface BackfillCharacterFeaturesResult {
  charactersProcessed: number;
  featuresCreated: number;
  skippedCharacters: number;
  errors: Array<{ characterId: string; error: string }>;
}

export async function backfillCanonicalCharacterFeatures(
  client: PrismaClient
): Promise<BackfillCharacterFeaturesResult> {
  const result: BackfillCharacterFeaturesResult = {
    charactersProcessed: 0,
    featuresCreated: 0,
    skippedCharacters: 0,
    errors: [],
  };

  const characters = await client.character.findMany({
    select: {
      id: true,
      name: true,
      class: true,
      level: true,
      features: { select: { featureCode: true } },
    },
  });

  for (const char of characters) {
    result.charactersProcessed++;

    try {
      if (char.features.length > 0) {
        result.skippedCharacters++;
        continue;
      }

      const featuresPayload = buildCanonicalCharacterFeatures({
        characterId: char.id,
        className: char.class,
        level: char.level,
      });

      if (featuresPayload.length === 0) {
        result.skippedCharacters++;
        continue;
      }

      const res = await client.characterFeature.createMany({
        data: featuresPayload,
        skipDuplicates: true,
      });

      result.featuresCreated += res.count;
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
    console.log("► Iniciando backfill de CharacterFeature...");
    const res = await backfillCanonicalCharacterFeatures(prisma);
    console.log(
      `✓ Backfill finalizado: ` +
        `procesados=${res.charactersProcessed}, ` +
        `features_creadas=${res.featuresCreated}, ` +
        `omitidos_o_al_día=${res.skippedCharacters}, ` +
        `errores=${res.errors.length}`
    );
    if (res.errors.length > 0) {
      console.warn("Advertencias/Errores encontrados:", res.errors);
    }
  } catch (error) {
    console.error("✗ Error fatal durante el backfill de features:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backfill-canonical-character-features.ts")) {
  void main();
}
