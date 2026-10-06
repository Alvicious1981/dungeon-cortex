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
  SRD_2014_CLASSES,
  SRD_2014_SUBCLASSES,
  SRD_2014_RACES,
  SRD_2014_TRAITS,
  SRD_2014_RACE_TRAITS,
  SRD_2014_BACKGROUNDS,
} from "../lib/rules/canonical/seed-data";

export interface CanonicalSeedResult {
  rulesetsUpserted: number;
  sourcesUpserted: number;
  abilitiesUpserted: number;
  skillsUpserted: number;
  languagesUpserted: number;
  proficienciesUpserted: number;
  classesUpserted: number;
  subclassesUpserted: number;
  racesUpserted: number;
  traitsUpserted: number;
  raceTraitsUpserted: number;
  backgroundsUpserted: number;
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
    classesUpserted: 0,
    subclassesUpserted: 0,
    racesUpserted: 0,
    traitsUpserted: 0,
    raceTraitsUpserted: 0,
    backgroundsUpserted: 0,
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

  // 7. Classes
  for (const cls of SRD_2014_CLASSES) {
    await client.canonicalClass.upsert({
      where: {
        rulesetId_code: {
          rulesetId: cls.rulesetId,
          code: cls.code,
        },
      },
      create: cls,
      update: {
        name: cls.name,
        hitDie: cls.hitDie,
        primaryAbility: cls.primaryAbility,
        spellcastingAbility: cls.spellcastingAbility,
        subclassLevel: cls.subclassLevel,
      },
    });
    result.classesUpserted++;
  }

  // 8. Subclasses
  for (const sub of SRD_2014_SUBCLASSES) {
    await client.canonicalSubclass.upsert({
      where: {
        rulesetId_classCode_code: {
          rulesetId: sub.rulesetId,
          classCode: sub.classCode,
          code: sub.code,
        },
      },
      create: sub,
      update: {
        name: sub.name,
        description: sub.description,
      },
    });
    result.subclassesUpserted++;
  }

  // 9. Races
  for (const race of SRD_2014_RACES) {
    await client.canonicalRace.upsert({
      where: {
        rulesetId_code: {
          rulesetId: race.rulesetId,
          code: race.code,
        },
      },
      create: race,
      update: {
        name: race.name,
        speed: race.speed,
        size: race.size,
        description: race.description,
      },
    });
    result.racesUpserted++;
  }

  // 10. Traits
  for (const trait of SRD_2014_TRAITS) {
    await client.canonicalTrait.upsert({
      where: {
        rulesetId_code: {
          rulesetId: trait.rulesetId,
          code: trait.code,
        },
      },
      create: trait,
      update: {
        name: trait.name,
        description: trait.description,
      },
    });
    result.traitsUpserted++;
  }

  // 11. Race Traits (Junction)
  for (const rt of SRD_2014_RACE_TRAITS) {
    await client.canonicalRaceTrait.upsert({
      where: {
        rulesetId_raceCode_traitCode: {
          rulesetId: rt.rulesetId,
          raceCode: rt.raceCode,
          traitCode: rt.traitCode,
        },
      },
      create: rt,
      update: {},
    });
    result.raceTraitsUpserted++;
  }

  // 12. Backgrounds
  for (const bg of SRD_2014_BACKGROUNDS) {
    await client.canonicalBackground.upsert({
      where: {
        rulesetId_code: {
          rulesetId: bg.rulesetId,
          code: bg.code,
        },
      },
      create: bg,
      update: {
        name: bg.name,
        description: bg.description,
        featureName: bg.featureName,
      },
    });
    result.backgroundsUpserted++;
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
        `proficiencies=${result.proficienciesUpserted}, ` +
        `classes=${result.classesUpserted}, ` +
        `subclasses=${result.subclassesUpserted}, ` +
        `races=${result.racesUpserted}, ` +
        `traits=${result.traitsUpserted}, ` +
        `raceTraits=${result.raceTraitsUpserted}, ` +
        `backgrounds=${result.backgroundsUpserted}`
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
