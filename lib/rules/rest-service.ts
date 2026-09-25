import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { abilityModifier, roll as defaultRoll } from "@/lib/rules/dice";
import { isSpellSlots, longRestSpellSlots, type SpellSlots } from "@/lib/rules/magic";
import { effectiveMaxHp } from "@/lib/rules/exhaustion";
import { hitDieForClass } from "@/lib/rules/progression";

export type RestType = "short" | "long";

export type RestServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "CHARACTER_CAMPAIGN_MISMATCH"
  | "INVALID_REST_TYPE"
  | "ACTIVE_ENCOUNTER"
  | "INVALID_HIT_DICE";

export class RestServiceError extends Error {
  constructor(
    public readonly code: RestServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RestServiceError";
  }
}

interface RestCampaignRecord {
  id: string;
  characterId?: string | null;
}

// Deliberately has no `campaignId`. `Character` does not carry one, and
// declaring it optional here is what let a `select` ask Prisma for it and a
// guard read it — the first throwing on every call, the second silently
// always false. Ownership is answered by `Campaign.characterId`.
interface RestCharacterRecord {
  id: string;
  hp: number;
  maxHp: number;
  level: number;
  class: string;
  stats: unknown;
  spellSlots: unknown;
  hitDiceTotal?: number | null;
  hitDiceRemaining?: number | null;
  exhaustionLevel?: number | null;
}

interface RestDb {
  $transaction?<T>(fn: (tx: RestDb) => Promise<T>): Promise<T>;
  $queryRaw?<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<RestCampaignRecord | null>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<RestCharacterRecord | null>;
    update(args: {
      where: { id: string };
      data: {
        hp?: number;
        spellSlots?: Prisma.InputJsonValue;
        hitDiceRemaining?: number;
        exhaustionLevel?: number;
      };
      select?: Record<string, boolean>;
    }): Promise<RestCharacterRecord>;
  };
  encounter: {
    findFirst(args: {
      where: { campaignId: string; status: string };
      select?: Record<string, boolean>;
    }): Promise<unknown | null>;
  };
}

export interface ResolveRestInput {
  campaignId: string;
  characterId?: string;
  restType: RestType | string;
  hitDiceToSpend?: number;
  roll?: (notation: string) => { total: number };
  tx?: RestDb;
  db?: RestDb;
}

export interface RestFacts {
  type: "rest_resolved";
  campaignId: string;
  characterId: string;
  restType: RestType;
  hpBefore: number;
  hpAfter: number;
  hpRecovered: number;
  hitDiceSpent: number;
  hitDiceRecovered: number;
  hitDiceRemainingBefore: number;
  hitDiceRemainingAfter: number;
  exhaustionReduced: number;
  slotsRestored: boolean;
  hitDie: string | null;
  rolled: number | null;
  conMod: number | null;
}

export interface ResolveRestResult {
  ok: true;
  restType: RestType;
  hpBefore: number;
  hpAfter: number;
  slotsRestored: boolean;
  hitDie?: string;
  rolled?: number;
  conMod?: number;
  healing?: number;
  character: {
    id: string;
    hp: number;
    maxHp: number;
    spellSlots: unknown;
  };
  facts: RestFacts;
}

function resolveDb(input: ResolveRestInput): RestDb {
  return input.tx ?? input.db ?? (prisma as unknown as RestDb);
}

function assertRestType(restType: string): asserts restType is RestType {
  if (restType !== "short" && restType !== "long") {
    throw new RestServiceError(
      "INVALID_REST_TYPE",
      "restType must be \"short\" or \"long\"."
    );
  }
}

function statsRecord(stats: unknown): Record<string, number> {
  return stats && typeof stats === "object" && !Array.isArray(stats)
    ? (stats as Record<string, number>)
    : {};
}

function currentHitDice(character: RestCharacterRecord): {
  total: number;
  remaining: number;
} {
  const total =
    Number.isInteger(character.hitDiceTotal) && character.hitDiceTotal! > 0
      ? character.hitDiceTotal!
      : Math.max(1, character.level);
  const remaining =
    Number.isInteger(character.hitDiceRemaining) && character.hitDiceRemaining! >= 0
      ? character.hitDiceRemaining!
      : total;

  return {
    total,
    remaining: Math.min(total, remaining),
  };
}

async function resolveCampaign(
  db: RestDb,
  input: ResolveRestInput
): Promise<RestCampaignRecord> {
  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, characterId: true },
  });

  if (!campaign) {
    throw new RestServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  return campaign;
}

/**
 * Takes the Character row lock before the row is read (DC-AUD-024).
 *
 * Both rests compute `hp` and `hitDiceRemaining` as absolute values from the
 * row they read, then write them back by id. Without this lock a rest that
 * commits between another rest's read and its write is erased: a healing short
 * rest resuming from its snapshot overwrote a long rest's full HP and recovered
 * Hit Die, while the long rest's exhaustion reduction survived — a row no
 * serial order of the two rests could produce. With it, the second rest waits,
 * then reads what the first committed.
 *
 * This is the only row lock a rest takes, so it cannot join a lock cycle; it is
 * the same Character-first lock the combat transactions take.
 *
 * Reduced test doubles may omit Prisma's raw-query surface. Production
 * transactions always expose it and therefore always take this lock.
 */
async function lockCharacterForRest(db: RestDb, characterId: string): Promise<void> {
  if (typeof db.$queryRaw !== "function") return;

  await db.$queryRaw`
    SELECT "id"
    FROM "Character"
    WHERE "id" = ${characterId}
    FOR UPDATE
  `;
}

async function resolveCharacter(
  db: RestDb,
  input: ResolveRestInput,
  campaign: RestCampaignRecord
): Promise<RestCharacterRecord> {
  const characterId = input.characterId ?? campaign.characterId;
  if (!characterId) {
    throw new RestServiceError(
      "CHARACTER_NOT_FOUND",
      `Campaign ${input.campaignId} has no character to rest.`
    );
  }

  await lockCharacterForRest(db, characterId);

  const character = await db.character.findUnique({
    where: { id: characterId },
    // No `campaignId`: `Character` has no such scalar — only the
    // `campaigns Campaign[]` relation — and selecting it makes real Prisma
    // throw `Unknown field campaignId`, which is a 500 on every rest.
    select: {
      id: true,
      hp: true,
      maxHp: true,
      level: true,
      class: true,
      stats: true,
      spellSlots: true,
      hitDiceTotal: true,
      hitDiceRemaining: true,
      exhaustionLevel: true,
    },
  });

  if (!character) {
    throw new RestServiceError(
      "CHARACTER_NOT_FOUND",
      `Character not found: ${characterId}`
    );
  }

  // The campaign row is the only side that can answer this. The second half of
  // this condition used to read `character.campaignId`, which is always
  // `undefined` against a real row, so it never contributed — the guard was
  // half no-op even before the select above made the query throw.
  if (campaign.characterId && campaign.characterId !== character.id) {
    throw new RestServiceError(
      "CHARACTER_CAMPAIGN_MISMATCH",
      `Character ${character.id} does not belong to campaign ${input.campaignId}.`
    );
  }

  return character;
}

async function assertNoActiveEncounter(
  db: RestDb,
  campaignId: string
): Promise<void> {
  const activeEncounter = await db.encounter.findFirst({
    where: { campaignId, status: "active" },
    select: { id: true },
  });

  if (activeEncounter) {
    throw new RestServiceError(
      "ACTIVE_ENCOUNTER",
      "Cannot rest during an active encounter."
    );
  }
}

/**
 * A warlock's Pact Magic slots refresh on completing any short rest per the
 * SRD, unlike every other class's slots, which only return on a long rest.
 * Reuses `longRestSpellSlots` for the table lookup — the SRD maxima are the
 * same "give every slot back" computation either way, only which classes get
 * it on a short rest differs.
 *
 * Returns null (no write) when the class is not a warlock or the recomputed
 * slots match what is already stored, so a short rest that finds a warlock
 * already topped up stays the database no-op it would otherwise be.
 */
function warlockSlotsAfterShortRest(character: RestCharacterRecord): SpellSlots | null {
  if (character.class.trim().toLowerCase() !== "warlock") return null;

  const restored = longRestSpellSlots(character.class, character.level, character.spellSlots);
  if (!restored) return null;

  const stored = isSpellSlots(character.spellSlots) ? character.spellSlots : null;
  const unchanged =
    stored !== null &&
    Object.keys(restored).every((key) => stored[key]?.current === restored[key]!.current);

  return unchanged ? null : restored;
}

function resolveShortRest(input: ResolveRestInput, character: RestCharacterRecord) {
  const hitDice = currentHitDice(character);
  // Exhaustion level 4+ halves the maximum a short rest can heal up to.
  const maxHp = effectiveMaxHp(character.maxHp, character.exhaustionLevel);
  const hpBefore = Math.max(0, Math.min(maxHp, character.hp));

  // Two different requests arrive here, and only one of them can be invalid.
  //
  // An explicit `hitDiceToSpend` is a caller naming a number: asking for more
  // dice than exist is an error, and stays one.
  //
  // No `hitDiceToSpend` is a player who typed "short rest" and named nothing.
  // The SRD calls a short rest "a period of downtime" and says a character
  // *can* spend Hit Dice at the end of it — taking the rest is not conditional
  // on having any, and spending is a choice made per die. So an implicit rest
  // spends one die when there is one to spend and it would do something, and
  // otherwise resolves having recovered nothing.
  //
  // Both edges used to be wrong in the same direction, against the player. No
  // dice left threw INVALID_HIT_DICE, so the rest was refused outright — and
  // a 4xx writes no canonical player row, so the narrator never learned the
  // party had rested at all. At full health it spent a die to heal zero,
  // silently destroying a resource only a long rest returns, half at a time.
  const explicit = input.hitDiceToSpend !== undefined;

  if (
    explicit &&
    (!Number.isInteger(input.hitDiceToSpend) ||
      input.hitDiceToSpend! < 1 ||
      input.hitDiceToSpend! > hitDice.remaining)
  ) {
    throw new RestServiceError(
      "INVALID_HIT_DICE",
      "hitDiceToSpend must be an integer within available Hit Dice."
    );
  }

  const hitDiceToSpend = explicit
    ? input.hitDiceToSpend!
    : hitDice.remaining > 0 && hpBefore < maxHp
      ? 1
      : 0;

  // Independent of Hit Dice: a warlock's Pact Magic refreshes on any short
  // rest, so this is computed before the hitDiceToSpend branch below decides
  // whether hp/Hit Dice themselves need a write.
  const warlockSlots = warlockSlotsAfterShortRest(character);

  if (hitDiceToSpend === 0) {
    // Nothing was rolled, so nothing is reported as rolled. `Math.max(1, …)`
    // below would otherwise grant a free hit point for a die never spent.
    //
    // hp/Hit Dice stay a database no-op here: rewriting the values read above
    // can erase a legitimate concurrent update that commits before this
    // request resumes (for example, a long rest recovering Hit Dice). A
    // warlock's slot refresh is the one exception — `warlockSlotsAfterShortRest`
    // already only returns non-null when something needs to change, so this
    // write is still skipped whenever there is truly nothing to update.
    return {
      data: warlockSlots
        ? { spellSlots: warlockSlots as unknown as Prisma.InputJsonValue }
        : null,
      details: {
        hpBefore,
        hpAfter: hpBefore,
        hpRecovered: 0,
        hitDiceSpent: 0,
        hitDiceRecovered: 0,
        hitDiceRemainingBefore: hitDice.remaining,
        hitDiceRemainingAfter: hitDice.remaining,
        exhaustionReduced: 0,
        slotsRestored: warlockSlots !== null,
        hitDie: null,
        rolled: null,
        conMod: null,
        healing: undefined,
      },
    };
  }

  const stats = statsRecord(character.stats);
  const conMod = abilityModifier(stats.CON ?? stats.constitution ?? 10);
  const hitDieSize = hitDieForClass(character.class);
  const diceExpression = `${hitDiceToSpend}d${hitDieSize}`;
  const rolled = (input.roll ?? defaultRoll)(diceExpression).total;
  const healing = Math.max(1, rolled + conMod * hitDiceToSpend);
  const hpAfter = Math.min(maxHp, hpBefore + healing);

  return {
    data: {
      hp: hpAfter,
      hitDiceRemaining: hitDice.remaining - hitDiceToSpend,
      ...(warlockSlots
        ? { spellSlots: warlockSlots as unknown as Prisma.InputJsonValue }
        : {}),
    },
    details: {
      hpBefore,
      hpAfter,
      hpRecovered: hpAfter - hpBefore,
      hitDiceSpent: hitDiceToSpend,
      hitDiceRecovered: 0,
      hitDiceRemainingBefore: hitDice.remaining,
      hitDiceRemainingAfter: hitDice.remaining - hitDiceToSpend,
      exhaustionReduced: 0,
      slotsRestored: warlockSlots !== null,
      hitDie: diceExpression,
      rolled,
      conMod,
      healing,
    },
  };
}

function resolveLongRest(character: RestCharacterRecord) {
  const hitDice = currentHitDice(character);
  const exhaustionBefore = Math.max(0, character.exhaustionLevel ?? 0);
  const exhaustionLevel = Math.max(0, exhaustionBefore - 1);
  const hpBefore = Math.max(
    0,
    Math.min(effectiveMaxHp(character.maxHp, exhaustionBefore), character.hp)
  );
  // Hit points are regained up to the maximum that applies once the rest has
  // also lowered exhaustion by one: a rest taking level 4 to level 3 ends with
  // the full maximum restored and reached.
  const hpAfter = Math.max(0, effectiveMaxHp(character.maxHp, exhaustionLevel));
  const hitDiceRecovered = Math.min(
    Math.max(1, Math.floor(hitDice.total / 2)),
    hitDice.total - hitDice.remaining
  );
  const hitDiceRemainingAfter = Math.min(
    hitDice.total,
    hitDice.remaining + hitDiceRecovered
  );
  // The maxima come from the SRD table for the class and level, not from the
  // stored slots, so a character whose slots were never raised when they
  // levelled up is whole again after one long rest.
  const slotsAfter = longRestSpellSlots(character.class, character.level, character.spellSlots);

  return {
    data: {
      hp: hpAfter,
      hitDiceRemaining: hitDiceRemainingAfter,
      exhaustionLevel,
      ...(slotsAfter !== null && slotsAfter !== undefined
        ? { spellSlots: slotsAfter as unknown as Prisma.InputJsonValue }
        : {}),
    },
    details: {
      hpBefore,
      hpAfter,
      hpRecovered: hpAfter - hpBefore,
      hitDiceSpent: 0,
      hitDiceRecovered,
      hitDiceRemainingBefore: hitDice.remaining,
      hitDiceRemainingAfter,
      exhaustionReduced: exhaustionBefore - exhaustionLevel,
      slotsRestored: slotsAfter !== null,
      hitDie: null,
      rolled: null,
      conMod: null,
      healing: undefined,
    },
  };
}

function buildResult(
  input: ResolveRestInput,
  restType: RestType,
  character: RestCharacterRecord,
  updated: RestCharacterRecord,
  details: ReturnType<typeof resolveShortRest>["details"] | ReturnType<typeof resolveLongRest>["details"]
): ResolveRestResult {
  const facts: RestFacts = {
    type: "rest_resolved",
    campaignId: input.campaignId,
    characterId: character.id,
    restType,
    hpBefore: details.hpBefore,
    hpAfter: updated.hp,
    hpRecovered: Math.max(0, updated.hp - details.hpBefore),
    hitDiceSpent: details.hitDiceSpent,
    hitDiceRecovered: details.hitDiceRecovered,
    hitDiceRemainingBefore: details.hitDiceRemainingBefore,
    hitDiceRemainingAfter: details.hitDiceRemainingAfter,
    exhaustionReduced: details.exhaustionReduced,
    slotsRestored: details.slotsRestored,
    hitDie: details.hitDie,
    rolled: details.rolled,
    conMod: details.conMod,
  };

  return {
    ok: true,
    restType,
    hpBefore: facts.hpBefore,
    hpAfter: facts.hpAfter,
    slotsRestored: facts.slotsRestored,
    ...(details.hitDie ? { hitDie: details.hitDie } : {}),
    ...(details.rolled !== null ? { rolled: details.rolled } : {}),
    ...(details.conMod !== null ? { conMod: details.conMod } : {}),
    ...(details.healing !== undefined ? { healing: details.healing } : {}),
    character: {
      id: updated.id,
      hp: updated.hp,
      maxHp: updated.maxHp,
      spellSlots: updated.spellSlots,
    },
    facts,
  };
}

async function resolveRestInTransaction(
  db: RestDb,
  input: ResolveRestInput
): Promise<ResolveRestResult> {
  assertRestType(input.restType);

  const campaign = await resolveCampaign(db, input);
  const character = await resolveCharacter(db, input, campaign);
  await assertNoActiveEncounter(db, input.campaignId);

  const resolved =
    input.restType === "short"
      ? resolveShortRest(input, character)
      : resolveLongRest(character);

  const updated =
    resolved.data === null
      ? character
      : await db.character.update({
          where: { id: character.id },
          data: resolved.data,
          select: {
            id: true,
            hp: true,
            maxHp: true,
            spellSlots: true,
            hitDiceRemaining: true,
            exhaustionLevel: true,
          },
        });

  return buildResult(input, input.restType, character, updated, resolved.details);
}

export async function resolveRest(
  input: ResolveRestInput
): Promise<ResolveRestResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return resolveRestInTransaction(db, input);
  }

  return db.$transaction((tx) => resolveRestInTransaction(tx, input));
}
