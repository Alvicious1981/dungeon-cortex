/**
 * scripts/backfill-canonical-character-abilities-skills.ts
 *
 * Sincronización e idempotencia de datos:
 * Lee los personajes existentes en la base de datos y genera sus registros
 * relacionales canónicos en CharacterAbility y CharacterSkillProficiency
 * a partir de sus blobs legacy (Character.stats y Character.skillProficiencies).
 *
 * Seguro y aditivo: no borra ningún personaje ni modifica las columnas legacy.
 *
 * Ejecución: npx tsx scripts/backfill-canonical-character-abilities-skills.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedCanonicalFoundation } from "./seed-canonical-foundation";
import { buildCanonicalCharacterAbilities } from "../lib/rules/canonical/character-abilities";
import { buildCanonicalCharacterSkills } from "../lib/rules/canonical/character-skills";

export interface BackfillResult {
  charactersProcessed: number;
  abilitiesUpserted: number;
  skillsUpserted: number;
}

export async function backfillCharacterAbilitiesAndSkills(
  client: PrismaClient
): Promise<BackfillResult> {
  // Asegura que las tablas canónicas maestras (CanonicalAbility, CanonicalSkill) estén sembradas
  await seedCanonicalFoundation(client);

  const characters = await client.character.findMany({
    select: {
      id: true,
      stats: true,
      skillProficiencies: true,
    },
  });

  const result: BackfillResult = {
    charactersProcessed: characters.length,
    abilitiesUpserted: 0,
    skillsUpserted: 0,
  };

  for (const char of characters) {
    // 1. Sincronizar características canónicas
    if (char.stats && typeof char.stats === "object" && !Array.isArray(char.stats)) {
      try {
        const abilities = buildCanonicalCharacterAbilities(
          char.id,
          char.stats as Record<string, number>
        );
        for (const ability of abilities) {
          await client.characterAbility.upsert({
            where: {
              characterId_abilityCode: {
                characterId: char.id,
                abilityCode: ability.abilityCode,
              },
            },
            create: ability,
            update: { baseScore: ability.baseScore },
          });
          result.abilitiesUpserted++;
        }
      } catch (err) {
        console.warn(`[backfill] No se pudieron sincronizar stats para personaje ${char.id}:`, err);
      }
    }

    // 2. Sincronizar competencias de habilidades canónicas
    if (Array.isArray(char.skillProficiencies)) {
      try {
        const skills = buildCanonicalCharacterSkills(
          char.id,
          char.skillProficiencies as string[]
        );
        for (const skill of skills) {
          await client.characterSkillProficiency.upsert({
            where: {
              characterId_skillCode: {
                characterId: char.id,
                skillCode: skill.skillCode,
              },
            },
            create: skill,
            update: { level: skill.level },
          });
          result.skillsUpserted++;
        }
      } catch (err) {
        console.warn(`[backfill] No se pudieron sincronizar skills para personaje ${char.id}:`, err);
      }
    }
  }

  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("► Iniciando backfill canónico de características y habilidades...");
    const res = await backfillCharacterAbilitiesAndSkills(prisma);
    console.log(
      `✓ Backfill completado: personajes=${res.charactersProcessed}, ` +
        `abilities=${res.abilitiesUpserted}, skills=${res.skillsUpserted}`
    );
  } catch (error) {
    console.error("✗ Error en el backfill canónico:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backfill-canonical-character-abilities-skills.ts")) {
  void main();
}
