import { prisma } from "@/lib/db/prisma";
import { abilityModifier } from "@/lib/rules/dice";
import {
  buildEncounter,
  encounterMultiplier,
  xpForCR,
  type SpawnEncounterInput,
} from "@/lib/rules/encounters";
import {
  acFromInventory,
  acFromMonsterData,
  rollInitiative,
} from "@/lib/rules/combat";
import {
  buildMonsterRawData,
  queryMonsters as defaultQueryMonsters,
} from "@/lib/rules/srd-monster-lookup";
import type { Monster } from "@/lib/rules/srd";

interface EncounterInventoryItemRecord {
  type: string;
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
  const playerAC = acFromInventory(campaign.character.inventory, playerDexMod);

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
