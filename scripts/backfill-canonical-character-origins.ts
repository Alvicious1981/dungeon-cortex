/**
 * scripts/backfill-canonical-character-origins.ts
 *
 * Script de migración de datos (backfill) seguro, determinista e idempotente.
 * Lee los personajes existentes en la base de datos y genera sus registros canónicos
 * en CharacterOrigin a partir de su columna legacy Character.race.
 *
 * Características de seguridad:
 * - Idempotente: omite personajes que ya tengan su fila en CharacterOrigin.
 * - Aditivo: no modifica ningún dato existente en Character, Campaign o Inventory.
 * - Transaccional por personaje: si falla un registro, reporta el error sin corromper el resto.
 *
 * Uso directo: npx tsx scripts/backfill-canonical-character-origins.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildCanonicalCharacterOrigin } from "../lib/rules/canonical/character-origins";

export interface BackfillCharacterOriginsResult {
  charactersProcessed: number;
  originsCreated: number;
  skippedCharacters: number;
  errors: Array<{ characterId: string; error: string }>;
}

export async function backfillCanonicalCharacterOrigins(
  client: PrismaClient
): Promise<BackfillCharacterOriginsResult> {
  const result: BackfillCharacterOriginsResult = {
    charactersProcessed: 0,
    originsCreated: 0,
    skippedCharacters: 0,
    errors: [],
  };

  const characters = await client.character.findMany({
    select: {
      id: true,
      name: true,
      race: true,
      origin: { select: { id: true, raceCode: true } },
    },
  });

  for (const char of characters) {
    result.charactersProcessed++;

    try {
      if (char.origin) {
        result.skippedCharacters++;
        continue;
      }

      const payload = buildCanonicalCharacterOrigin({
        characterId: char.id,
        rawRace: char.race,
      });

      if (!payload) {
        result.skippedCharacters++;
        continue;
      }

      await client.characterOrigin.create({
        data: payload,
      });
      result.originsCreated++;
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
    console.log("► Iniciando backfill de CharacterOrigin...");
    const res = await backfillCanonicalCharacterOrigins(prisma);
    console.log(
      `✓ Backfill finalizado: ` +
        `procesados=${res.charactersProcessed}, ` +
        `origenes_creados=${res.originsCreated}, ` +
        `omitidos_o_al_día=${res.skippedCharacters}, ` +
        `errores=${res.errors.length}`
    );
    if (res.errors.length > 0) {
      console.warn("Advertencias/Errores encontrados:", res.errors);
    }
  } catch (error) {
    console.error("✗ Error fatal durante el backfill de orígenes:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backfill-canonical-character-origins.ts")) {
  void main();
}
