/**
 * scripts/seed-canonical-foundation.ts
 *
 * Siembra determinista e idempotente de la infraestructura de reglas canónicas:
 * - Ruleset D&D 5e 2014
 * - RuleSource SRD 5.1
 * - 6 Características canónicas (STR, DEX, CON, INT, WIS, CHA)
 * - 18 Habilidades oficiales del SRD vinculadas a su característica
 * - 16 Idiomas del SRD (estándar y exóticos)
 *
 * Seguro y aditivo: no modifica ningún dato de Character, Campaign, Combatant o User.
 *
 * Ejecución directa: npx tsx scripts/seed-canonical-foundation.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  SRD_2014_RULESET,
  SRD_5_1_SOURCE,
  SRD_2014_ABILITIES,
  SRD_2014_SKILLS,
  SRD_2014_LANGUAGES,
  SRD_2014_PROFICIENCIES,
} from "../lib/rules/canonical/seed-data";

export interface CanonicalSeedResult {
  rulesetsUpserted: number;
  sourcesUpserted: number;
  abilitiesUpserted: number;
  skillsUpserted: number;
  languagesUpserted: number;
  proficienciesUpserted: number;
}


export async function seedCanonicalFoundation(
  client: PrismaClient
): Promise<CanonicalSeedResult> {
  const result: CanonicalSeedResult = {
    rulesetsUpserted: 0,
    sourcesUpserted: 0,
    abilitiesUpserted: 0,
    skillsUpserted: 0,
    languagesUpserted: 0,
    proficienciesUpserted: 0,
  };

  // 1. Ruleset
  await client.ruleset.upsert({
    where: { id: SRD_2014_RULESET.id },
    create: SRD_2014_RULESET,
    update: {
      name: SRD_2014_RULESET.name,
      version: SRD_2014_RULESET.version,
      status: SRD_2014_RULESET.status,
      isDefault: SRD_2014_RULESET.isDefault,
    },
  });
  result.rulesetsUpserted++;

  // 2. RuleSource
  await client.ruleSource.upsert({
    where: {
      rulesetId_code: {
        rulesetId: SRD_5_1_SOURCE.rulesetId,
        code: SRD_5_1_SOURCE.code,
      },
    },
    create: SRD_5_1_SOURCE,
    update: {
      title: SRD_5_1_SOURCE.title,
      publisher: SRD_5_1_SOURCE.publisher,
      url: SRD_5_1_SOURCE.url,
      license: SRD_5_1_SOURCE.license,
    },
  });
  result.sourcesUpserted++;

  // 3. Abilities
  for (const ability of SRD_2014_ABILITIES) {
    await client.canonicalAbility.upsert({
      where: {
        rulesetId_code: {
          rulesetId: ability.rulesetId,
          code: ability.code,
        },
      },
      create: ability,
      update: {
        name: ability.name,
        description: ability.description,
        orderIndex: ability.orderIndex,
      },
    });
    result.abilitiesUpserted++;
  }

  // 4. Skills
  for (const skill of SRD_2014_SKILLS) {
    await client.canonicalSkill.upsert({
      where: {
        rulesetId_code: {
          rulesetId: skill.rulesetId,
          code: skill.code,
        },
      },
      create: skill,
      update: {
        name: skill.name,
        abilityCode: skill.abilityCode,
      },
    });
    result.skillsUpserted++;
  }

  // 5. Languages
  for (const lang of SRD_2014_LANGUAGES) {
    await client.canonicalLanguage.upsert({
      where: {
        rulesetId_code: {
          rulesetId: lang.rulesetId,
          code: lang.code,
        },
      },
      create: lang,
      update: {
        name: lang.name,
        type: lang.type,
        script: lang.script,
      },
    });
    result.languagesUpserted++;
  }

  // 6. Generic Proficiencies (Armor, Weapon, Saving Throw, Tool)
  for (const prof of SRD_2014_PROFICIENCIES) {
    await client.canonicalProficiency.upsert({
      where: {
        rulesetId_type_code: {
          rulesetId: prof.rulesetId,
          type: prof.type,
          code: prof.code,
        },
      },
      create: prof,
      update: {
        name: prof.name,
        description: prof.description,
      },
    });
    result.proficienciesUpserted++;
  }

  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("► Sembrando infraestructura canónica de reglas (SRD 5.1 / 2014)...");
    const result = await seedCanonicalFoundation(prisma);
    console.log(
      `✓ Siembra canónica completada con éxito: ` +
        `rulesets=${result.rulesetsUpserted}, ` +
        `sources=${result.sourcesUpserted}, ` +
        `abilities=${result.abilitiesUpserted}, ` +
        `skills=${result.skillsUpserted}, ` +
        `languages=${result.languagesUpserted}, ` +
        `proficiencies=${result.proficienciesUpserted}`
    );
  } catch (error) {
    console.error("✗ Error durante la siembra canónica:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed-canonical-foundation.ts")) {
  void main();
}
