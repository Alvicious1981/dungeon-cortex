import { prisma } from "@/lib/db/prisma";
import { abilityModifier } from "@/lib/rules/dice";
import {
  buildEncounter,
  encounterMultiplier,
  xpForCR,
  type SpawnEncounterInput,
} from "@/lib/rules/encounters";
import {
  acFromMonsterData,
  rollInitiative,
} from "@/lib/rules/combat";
import { armorClassFor } from "@/lib/rules/armor-class";
import { conditionImmunityIndexes } from "@/lib/rules/condition-immunity";
import {
  buildMonsterRawData,
  queryMonsters as defaultQueryMonsters,
} from "@/lib/rules/srd-monster-lookup";
import type { Monster } from "@/lib/rules/srd";

export interface EncounterInventoryItemRecord {
  type: string;
  /**
   * Required by the armour rule. Declared here because `ArmorInventoryRow`
   * makes it optional: omitting it compiles and computes every player as
   * unarmoured.
   */
  equippedSlot?: string | null;
  properties: unknown;
}

interface EncounterCharacterRecord {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  stats: unknown;
  inventory: EncounterInventoryItemRecord[];
}

interface EncounterCampaignRecord {
  character: EncounterCharacterRecord;
}

interface ActiveEncounterRecord {
  id: string;
}

interface CreatedCombatantRecord {
  name: string;
  initiativeTotal: number;
  isPlayer: boolean;
}

interface CreatedEncounterRecord {
  id: string;
  combatants: CreatedCombatantRecord[];
}

interface EncounterDb {
  campaign: {
    findUnique(args: {
      where: { id: string };
      include: { character: { include: { inventory: boolean } } };
    }): Promise<EncounterCampaignRecord | null>;
  };
  encounter: {
    findFirst(args: {
      where: { campaignId: string; status: string };
    }): Promise<ActiveEncounterRecord | null>;
    create(args: {
      data: {
        campaignId: string;
        status: string;
        round: number;
        currentTurnIndex: number;
        combatants: {
          create: Array<{
            name: string;
            isPlayer: boolean;
            hp: number;
            maxHp: number;
            ac: number;
            initiativeTotal: number;
            /// Backend-authorized XP snapshot (docs/DECISION_XP_AWARD_AUTHORITY.md §5-§6).
            /// null = unavailable; never derived from adjustedXP/xpForCR/encounterMultiplier.
            xpValue: number | null;
          }>;
        };
      };
      include: {
        combatants: { orderBy: { initiativeTotal: "desc" } };
      };
    }): Promise<CreatedEncounterRecord>;
  };
}

export interface SpawnCombatEncounterInput extends SpawnEncounterInput {
  campaignId: string;
  db?: EncounterDb;
  queryMonsters?: typeof defaultQueryMonsters;
}

export type SpawnCombatEncounterResult =
  | {
      ok: true;
      encounterId: string;
      enemies: Array<{
        name: string;
        cr: number;
        hp: number;
      }>;
      adjustedXP: number;
      initiativeOrder: Array<{
        name: string;
        initiative: number;
        isPlayer: boolean;
      }>;
    }
  | { error: "Campaign not found." }
  | {
      error: "An active encounter already exists.";
      encounterId: string;
    }
  | {
      error: "No suitable monsters found for this encounter configuration.";
    };

function resolveDb(input: SpawnCombatEncounterInput): EncounterDb {
  return input.db ?? (prisma as unknown as EncounterDb);
}

function characterStats(character: EncounterCharacterRecord): Record<string, number> {
  if (typeof character.stats === "object" && character.stats !== null) {
    return character.stats as Record<string, number>;
  }

  return {};
}

/**
 * The ability-score fields of an SRD monster, however it reached us.
 *
 * Deliberately looser than `Monster`: the same six scores arrive both as a
 * parsed Monster and as the raw `SrdMonster.data` JSON, which is untyped. Both
 * spell the fields the same way, so one projection serves both and the two
 * encounter-creation paths cannot drift into disagreeing about a creature's
 * statistics.
 */
export interface MonsterAbilityFields {
  strength?: unknown;
  dexterity?: unknown;
  constitution?: unknown;
  intelligence?: unknown;
  wisdom?: unknown;
  charisma?: unknown;
}

/**
 * Projects an SRD monster's ability scores onto the combatant stats convention.
 *
 * The engine reads creature ability scores as three-letter uppercase keys
 * (`stats.STR`, `stats.DEX`, …) — the same shape Character.stats uses — so a
 * monster's SRD fields are mapped rather than copied verbatim.
 *
 * A missing score becomes 10, the SRD average, instead of being left absent.
 * Callers apply `?? 10` anyway; making the fallback explicit here means a
 * persisted combatant always carries a complete, readable stat block.
 */
export function monsterAbilityScores(
  monster: MonsterAbilityFields
): Record<string, number> {
  const score = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 10;

  return {
    STR: score(monster.strength),
    DEX: score(monster.dexterity),
    CON: score(monster.constitution),
    INT: score(monster.intelligence),
    WIS: score(monster.wisdom),
    CHA: score(monster.charisma),
  };
}

function monsterMaxCr(targetCR: number): number {
  return targetCR === 0 ? 1 : Math.min(targetCR * 2, 30);
}

function calculateAdjustedXP(monsters: Monster[]): number {
  const rawXP = monsters.reduce(
    (sum, monster) => sum + xpForCR(monster.challenge_rating ?? 0),
    0
  );

  return Math.round(rawXP * encounterMultiplier(monsters.length));
}

export async function spawnCombatEncounter(
  input: SpawnCombatEncounterInput
): Promise<SpawnCombatEncounterResult> {
  const db = resolveDb(input);
  const lookupMonsters = input.queryMonsters ?? defaultQueryMonsters;

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    include: { character: { include: { inventory: true } } },
  });
  if (!campaign) return { error: "Campaign not found." };

  const existing = await db.encounter.findFirst({
    where: { campaignId: input.campaignId, status: "active" },
  });
  if (existing) {
    return {
      error: "An active encounter already exists.",
      encounterId: existing.id,
    };
  }

  const typedMonsters = await lookupMonsters({
    type: input.theme,
    maxCR: monsterMaxCr(input.targetCR),
    limit: 30,
  });

  const selectedMonsters = buildEncounter(
    input.targetCR,
    typedMonsters,
    input.theme
  );

  if (selectedMonsters.length === 0) {
    return {
      error: "No suitable monsters found for this encounter configuration.",
    };
  }

  const stats = characterStats(campaign.character);
  const playerDexMod = abilityModifier(stats.DEX ?? 10);
  const playerAC = armorClassFor({
    inventory: campaign.character.inventory,
    dexModifier: playerDexMod,
  }).armorClass;

  const initiativeInputs = [
    {
      id: `player-${campaign.character.id}`,
      name: campaign.character.name,
      dexModifier: playerDexMod,
    },
    ...selectedMonsters.map((monster, index) => ({
      id: `enemy-${index}`,
      name: monster.name,
      dexModifier: abilityModifier(monster.dexterity ?? 10),
    })),
  ];

  const { order } = rollInitiative(initiativeInputs);

  const combatantData = order.map((entry) => {
    const isPlayer = entry.id.startsWith("player-");
    if (isPlayer) {
      return {
        name: campaign.character.name,
        isPlayer: true,
        hp: campaign.character.hp,
        maxHp: campaign.character.maxHp,
        ac: playerAC,
        initiativeTotal: entry.initiative,
        // Persisted so rules that resolve against a creature's ability scores
        // read real numbers. Without this the column kept its {} default and
        // every such rule silently saw 10 for everyone.
        stats,
        // Explicit, not defaulted: a rule that reads `.length` must never meet
        // undefined. No rule in this codebase grants a player resistance.
        damageImmunities: [],
        damageResistances: [],
        damageVulnerabilities: [],
        conditionImmunities: [],
        // The player is never a source of the combat XP award (§7 of the decision only
        // sums isPlayer === false combatants), so it never carries an authorized value.
        xpValue: null,
      };
    }

    const monsterIndex = parseInt(entry.id.replace("enemy-", ""), 10);
    const monster = selectedMonsters[monsterIndex]!;
    return {
      name: monster.name,
      isPlayer: false,
      hp: monster.hit_points,
      maxHp: monster.hit_points,
      ac: acFromMonsterData(buildMonsterRawData(monster)),
      initiativeTotal: entry.initiative,
      stats: monsterAbilityScores(monster),
      // Snapshotted rather than looked up at damage time: Combatant has no
      // reference back to SrdMonster, only a name, and resolving by name in the
      // combat path would be a guess dressed as a query.
      damageImmunities: monster.damage_immunities ?? [],
      damageResistances: monster.damage_resistances ?? [],
      damageVulnerabilities: monster.damage_vulnerabilities ?? [],
      conditionImmunities: conditionImmunityIndexes(monster.condition_immunities),
      // Backend-authorized SRD figure already resolved in memory by queryMonsters;
      // never xpForCR/adjustedXP/encounterMultiplier.
      xpValue: monster.xp ?? null,
    };
  });

  const encounter = await db.encounter.create({
    data: {
      campaignId: input.campaignId,
      status: "active",
      round: 1,
      currentTurnIndex: 0,
      combatants: { create: combatantData },
    },
    include: {
      combatants: { orderBy: { initiativeTotal: "desc" } },
    },
  });

  return {
    ok: true,
    encounterId: encounter.id,
    enemies: selectedMonsters.map((monster) => ({
      name: monster.name,
      cr: monster.challenge_rating ?? 0,
      hp: monster.hit_points,
    })),
    adjustedXP: calculateAdjustedXP(selectedMonsters),
    initiativeOrder: encounter.combatants.map((combatant) => ({
      name: combatant.name,
      initiative: combatant.initiativeTotal,
      isPlayer: combatant.isPlayer,
    })),
  };
}
