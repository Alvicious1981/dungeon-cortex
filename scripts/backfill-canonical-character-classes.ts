/**
 * scripts/backfill-canonical-character-classes.ts
 *
 * Script de migración de datos (backfill) seguro, determinista e idempotente.
 * Lee los personajes existentes en la base de datos y genera sus registros canónicos
 * en CharacterClassLevel a partir de sus columnas legacy Character.class y Character.level.
 *
 * Características de seguridad:
 * - Idempotente: omite personajes que ya tengan su fila en CharacterClassLevel.
 * - Aditivo: no modifica ningún dato existente en Character, Campaign o Inventory.
 * - Transaccional por personaje: si falla un registro, reporta el error sin corromper el resto.
 *
 * Uso directo: npx tsx scripts/backfill-canonical-character-classes.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildCanonicalCharacterClassLevel } from "../lib/rules/canonical/character-classes";

export interface BackfillCharacterClassesResult {
  charactersProcessed: number;
  classLevelsCreated: number;
  skippedCharacters: number;
  errors: Array<{ characterId: string; error: string }>;
}

export async function backfillCanonicalCharacterClasses(
  client: PrismaClient
): Promise<BackfillCharacterClassesResult> {
  const result: BackfillCharacterClassesResult = {
    charactersProcessed: 0,
    classLevelsCreated: 0,
    skippedCharacters: 0,
    errors: [],
  };

  const characters = await client.character.findMany({
    select: {
      id: true,
      name: true,
      class: true,
      level: true,
      classLevels: { select: { classCode: true, level: true } },
    },
  });

  for (const char of characters) {
    result.charactersProcessed++;

    try {
      if (char.classLevels.length > 0) {
        result.skippedCharacters++;
        continue;
      }

      const payload = buildCanonicalCharacterClassLevel({
        characterId: char.id,
        className: char.class,
        level: char.level,
        isPrimary: true,
      });

      if (!payload) {
        result.skippedCharacters++;
        continue;
      }

      await client.characterClassLevel.create({
        data: payload,
      });
      result.classLevelsCreated++;
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
    console.log("► Iniciando backfill de CharacterClassLevel...");
    const res = await backfillCanonicalCharacterClasses(prisma);
    console.log(
      `✓ Backfill finalizado: ` +
        `procesados=${res.charactersProcessed}, ` +
        `niveles_clase_creados=${res.classLevelsCreated}, ` +
        `omitidos_o_al_día=${res.skippedCharacters}, ` +
        `errores=${res.errors.length}`
    );
    if (res.errors.length > 0) {
      console.warn("Advertencias/Errores encontrados:", res.errors);
    }
  } catch (error) {
    console.error("✗ Error fatal durante el backfill de clases:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backfill-canonical-character-classes.ts")) {
  void main();
}
