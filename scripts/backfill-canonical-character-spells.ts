/**
 * scripts/backfill-canonical-character-spells.ts
 *
 * Script de migración de datos (backfill) seguro, determinista e idempotente.
 * Lee los personajes existentes en la base de datos y genera sus registros canónicos
 * en CharacterSpellSlot a partir de Character.spellSlots (o su clase y nivel si procede).
 *
 * Características de seguridad:
 * - Idempotente: omite personajes que ya cuentan con registros en CharacterSpellSlot.
 * - Aditivo: no modifica ningún dato existente en Character, Campaign o Inventory.
 * - Transaccional por personaje: si falla un registro, reporta el error sin corromper el resto.
 *
 * Uso directo: npx tsx scripts/backfill-canonical-character-spells.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { isSpellSlots } from "../lib/rules/magic";
import {
  legacySpellSlotsToCanonicalRecords,
  buildCanonicalCharacterSpellSlots,
} from "../lib/rules/canonical/character-magic";

export interface BackfillCharacterSpellsResult {
  charactersProcessed: number;
  slotsCreated: number;
  skippedCharacters: number;
  errors: Array<{ characterId: string; error: string }>;
}

export async function backfillCanonicalCharacterSpells(
  client: PrismaClient
): Promise<BackfillCharacterSpellsResult> {
  const result: BackfillCharacterSpellsResult = {
    charactersProcessed: 0,
    slotsCreated: 0,
    skippedCharacters: 0,
    errors: [],
  };

  const characters = await client.character.findMany({
    select: {
      id: true,
      name: true,
      class: true,
      level: true,
      spellSlots: true,
      spellSlotRecords: { select: { spellLevel: true } },
    },
  });

  for (const char of characters) {
    result.charactersProcessed++;

    try {
      if (char.spellSlotRecords.length > 0) {
        result.skippedCharacters++;
        continue;
      }

      let slotsPayload = isSpellSlots(char.spellSlots)
        ? legacySpellSlotsToCanonicalRecords(char.id, char.spellSlots)
        : [];

      if (slotsPayload.length === 0) {
        slotsPayload = buildCanonicalCharacterSpellSlots({
          characterId: char.id,
          className: char.class,
          level: char.level,
        });
      }

      if (slotsPayload.length === 0) {
        result.skippedCharacters++;
        continue;
      }

      const res = await client.characterSpellSlot.createMany({
        data: slotsPayload,
        skipDuplicates: true,
      });

      result.slotsCreated += res.count;
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
    console.log("► Iniciando backfill de CharacterSpellSlot...");
    const res = await backfillCanonicalCharacterSpells(prisma);
    console.log(
      `✓ Backfill finalizado: ` +
        `procesados=${res.charactersProcessed}, ` +
        `slots_creados=${res.slotsCreated}, ` +
        `omitidos_o_al_día=${res.skippedCharacters}, ` +
        `errores=${res.errors.length}`
    );
    if (res.errors.length > 0) {
      console.warn("Advertencias/Errores encontrados:", res.errors);
    }
  } catch (error) {
    console.error("✗ Error fatal durante el backfill de slots:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backfill-canonical-character-spells.ts")) {
  void main();
}
