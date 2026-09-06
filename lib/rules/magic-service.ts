import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { armorPenaltyFor, describeArmorPenalty } from "@/lib/rules/armor-proficiency";
import type { ArmorInventoryRow } from "@/lib/rules/armor-class";
import {
  consumeSlot,
  hasAvailableSlot,
  isSpellSlots,
  type SpellSlots,
} from "@/lib/rules/magic";

export type MagicServiceErrorCode =
  | "CAMPAIGN_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "CHARACTER_CAMPAIGN_MISMATCH"
  | "SPELL_NOT_FOUND"
  | "INVALID_SPELL_LEVEL"
  | "INVALID_SLOT_LEVEL"
  | "SLOT_LEVEL_TOO_LOW"
  | "NO_SPELL_SLOT_AVAILABLE"
  | "INVALID_SPELL_SLOTS"
  | "ARMOR_PROFICIENCY_REQUIRED";

export class MagicServiceError extends Error {
  constructor(
    public readonly code: MagicServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "MagicServiceError";
  }
}

interface MagicCampaignRecord {
  id: string;
  characterId?: string;
}

interface MagicCharacterRecord {
  id: string;
  /**
   * Legacy test-double compatibility only. The real Prisma Character model has
   * no campaignId; production ownership is authoritative on Campaign.characterId.
   * Never select this field from Prisma.
   */
  campaignId?: string;
  spellSlots: unknown;
  /**
   * Read for the armour-proficiency refusal. Optional because test doubles
   * predate the select; absent data yields no armour and so no refusal.
   */
  class?: string | null;
  inventory?: ArmorInventoryRow[] | null;
}

interface MagicSpellRecord {
  id: string;
  level: number | null;
  name?: string | null;
}

interface MagicDb {
  $transaction?<T>(fn: (tx: MagicDb) => Promise<T>): Promise<T>;
  campaign: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<MagicCampaignRecord | null>;
  };
  character: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<MagicCharacterRecord | null>;
    update(args: {
      where: { id: string };
      data: { spellSlots: Prisma.InputJsonValue };
      select?: Record<string, boolean>;
    }): Promise<MagicCharacterRecord>;
    /**
     * Production Prisma exposes updateMany. Keeping it optional preserves old
     * injected test doubles while allowing real database callers to use the
     * compare-and-set path below.
     */
    updateMany?(args: {
      where: {
        id: string;
        spellSlots: { equals: Prisma.InputJsonValue };
      };
      data: { spellSlots: Prisma.InputJsonValue };
    }): Promise<{ count: number }>;
  };
  srdSpell?: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<MagicSpellRecord | null>;
  };
}

export interface CastSpellInput {
  campaignId: string;
  characterId?: string;
  spellId?: string;
  spellLevel: number;
  slotLevel?: number;
  tx?: MagicDb;
  db?: MagicDb;
}

export interface SpellCastFacts {
  type: "spell_cast";
  campaignId: string;
  characterId: string;
  spellId: string | null;
  spellLevel: number;
  slotLevel: number | null;
  slotConsumed: boolean;
  spellSlotsBefore: SpellSlots | null;
  spellSlotsAfter: SpellSlots | null;
}

export interface CastSpellResult {
  ok: true;
  spellSlots: SpellSlots | null;
  facts: SpellCastFacts;
}

function resolveDb(input: CastSpellInput): MagicDb {
  return input.tx ?? input.db ?? (prisma as unknown as MagicDb);
}

function assertSpellLevel(spellLevel: number): void {
  if (!Number.isInteger(spellLevel) || spellLevel < 0 || spellLevel > 9) {
    throw new MagicServiceError(
      "INVALID_SPELL_LEVEL",
      "spellLevel must be an integer between 0 and 9."
    );
  }
}

function assertSlotLevel(slotLevel: number): void {
  if (!Number.isInteger(slotLevel) || slotLevel < 1 || slotLevel > 9) {
    throw new MagicServiceError(
      "INVALID_SLOT_LEVEL",
      "slotLevel must be an integer between 1 and 9."
    );
  }
}

function assertValidSlots(slots: unknown): asserts slots is SpellSlots {
  if (!isSpellSlots(slots)) {
    throw new MagicServiceError(
      "INVALID_SPELL_SLOTS",
      "Character spell slot data is missing or invalid."
    );
  }

  for (const [level, entry] of Object.entries(slots)) {
    const numericLevel = Number(level);
    if (
      !Number.isInteger(numericLevel) ||
      numericLevel < 1 ||
      numericLevel > 9 ||
      !Number.isInteger(entry.current) ||
      !Number.isInteger(entry.max) ||
      entry.current < 0 ||
      entry.max < 0 ||
      entry.current > entry.max
    ) {
      throw new MagicServiceError(
        "INVALID_SPELL_SLOTS",
        "Character spell slot data is missing or invalid."
      );
    }
  }
}

async function resolveCampaign(
  db: MagicDb,
  input: CastSpellInput
): Promise<MagicCampaignRecord> {
  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, characterId: true },
  });

  if (!campaign) {
    throw new MagicServiceError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign not found: ${input.campaignId}`
    );
  }

  return campaign;
}

async function resolveCharacter(
  db: MagicDb,
  input: CastSpellInput,
  campaign: MagicCampaignRecord
): Promise<MagicCharacterRecord> {
  const characterId = input.characterId ?? campaign.characterId;
  if (!characterId) {
    throw new MagicServiceError(
      "CHARACTER_NOT_FOUND",
      `Campaign ${input.campaignId} has no character to cast a spell.`
    );
  }

  const character = await db.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      spellSlots: true,
      // On the read that was already happening: no extra query buys the gate.
      class: true,
      inventory: true,
    },
  });

  if (!character) {
    throw new MagicServiceError(
      "CHARACTER_NOT_FOUND",
      `Character not found: ${characterId}`
    );
  }

  // Production ownership comes from Campaign.characterId, which is required by
  // the Prisma schema. The fallback only preserves older injected test doubles
  // whose campaign fixture predates that field.
  const campaignMismatch = campaign.characterId
    ? campaign.characterId !== character.id
    : Boolean(character.campaignId && character.campaignId !== input.campaignId);

  if (campaignMismatch) {
    throw new MagicServiceError(
      "CHARACTER_CAMPAIGN_MISMATCH",
      `Character ${character.id} does not belong to campaign ${input.campaignId}.`
    );
  }

  return character;
}

/**
 * SRD 2014: armour you lack proficiency with means you cannot cast at all.
 *
 * This is a refusal, not a penalty, and it lives here rather than in the route
 * because `app/api/campaign/[id]/magic/cast/route.ts` is not the only caller
 * that could ever reach `castSpell`. It runs before any slot is read or spent,
 * so a refused cast costs the character nothing. Cantrips are refused too: the
 * rule says spells, not levelled spells.
 *
 * The action route enforces the same rule at its own `cast_spell` gate, which
 * refuses before it reaches this service at all.
 */
function assertArmorPermitsCasting(character: MagicCharacterRecord): void {
  const penalty = armorPenaltyFor({
    inventory: character.inventory ?? [],
    characterClass: character.class ?? "",
  });

  if (penalty.applies) {
    throw new MagicServiceError(
      "ARMOR_PROFICIENCY_REQUIRED",
      `Cannot cast while using ${describeArmorPenalty(penalty)} without proficiency.`
    );
  }
}

async function assertSpellIfProvided(
  db: MagicDb,
  input: CastSpellInput
): Promise<void> {
  if (!input.spellId || !db.srdSpell) return;

  const spell = await db.srdSpell.findUnique({
    where: { id: input.spellId },
    select: { id: true, level: true, name: true },
  });

  if (!spell) {
    throw new MagicServiceError(
      "SPELL_NOT_FOUND",
      `Spell not found: ${input.spellId}`
    );
  }

  if (spell.level !== null && spell.level !== input.spellLevel) {
    throw new MagicServiceError(
      "INVALID_SPELL_LEVEL",
      `spellLevel does not match spell ${input.spellId}.`
    );
  }
}

function buildFacts(
  input: CastSpellInput,
  characterId: string,
  details: {
    slotLevel: number | null;
    slotConsumed: boolean;
    spellSlotsBefore: SpellSlots | null;
    spellSlotsAfter: SpellSlots | null;
  }
): SpellCastFacts {
  return {
    type: "spell_cast",
    campaignId: input.campaignId,
    characterId,
    spellId: input.spellId ?? null,
    spellLevel: input.spellLevel,
    slotLevel: details.slotLevel,
    slotConsumed: details.slotConsumed,
    spellSlotsBefore: details.spellSlotsBefore,
    spellSlotsAfter: details.spellSlotsAfter,
  };
}

async function persistSlotConsumption(
  db: MagicDb,
  character: MagicCharacterRecord,
  slotLevel: number
): Promise<{ before: SpellSlots; after: SpellSlots }> {
  assertValidSlots(character.spellSlots);
  let currentSlots = character.spellSlots;

  while (true) {
    if (!hasAvailableSlot(currentSlots, slotLevel)) {
      throw new MagicServiceError(
        "NO_SPELL_SLOT_AVAILABLE",
        `No available spell slots remaining at level ${slotLevel}.`
      );
    }

    const updatedSlots = consumeSlot(currentSlots, slotLevel);

    // Legacy injected test doubles predate updateMany. Real Prisma callers must
    // take the compare-and-set path below; the fallback keeps those old isolated
    // contract fixtures usable without pretending they provide concurrency safety.
    if (!db.character.updateMany) {
      const updatedCharacter = await db.character.update({
        where: { id: character.id },
        data: { spellSlots: updatedSlots as unknown as Prisma.InputJsonValue },
        select: { spellSlots: true },
      });
      const persisted = isSpellSlots(updatedCharacter.spellSlots)
        ? updatedCharacter.spellSlots
        : updatedSlots;
      return { before: currentSlots, after: persisted };
    }

    // Compare-and-set: the JSON value that authorised the consumption is part
    // of the write predicate. Under PostgreSQL READ COMMITTED, a competing
    // writer that changes spellSlots makes this predicate stop matching after
    // its row lock is released, so a stale snapshot can never overwrite it.
    const applied = await db.character.updateMany({
      where: {
        id: character.id,
        spellSlots: {
          equals: currentSlots as unknown as Prisma.InputJsonValue,
        },
      },
      data: {
        spellSlots: updatedSlots as unknown as Prisma.InputJsonValue,
      },
    });

    if (applied.count === 1) {
      return { before: currentSlots, after: updatedSlots };
    }

    // Another transaction changed spellSlots after our read. Refresh and retry
    // against that committed state rather than writing the stale absolute value.
    const refreshed = await db.character.findUnique({
      where: { id: character.id },
      select: { id: true, spellSlots: true },
    });

    if (!refreshed) {
      throw new MagicServiceError(
        "CHARACTER_NOT_FOUND",
        `Character not found: ${character.id}`
      );
    }

    assertValidSlots(refreshed.spellSlots);
    currentSlots = refreshed.spellSlots;
  }
}

async function castSpellInTransaction(
  db: MagicDb,
  input: CastSpellInput
): Promise<CastSpellResult> {
  assertSpellLevel(input.spellLevel);

  const campaign = await resolveCampaign(db, input);
  const character = await resolveCharacter(db, input, campaign);
  assertArmorPermitsCasting(character);
  await assertSpellIfProvided(db, input);

  if (input.spellLevel === 0) {
    const slots = isSpellSlots(character.spellSlots) ? character.spellSlots : null;
    return {
      ok: true,
      spellSlots: slots,
      facts: buildFacts(input, character.id, {
        slotLevel: null,
        slotConsumed: false,
        spellSlotsBefore: slots,
        spellSlotsAfter: slots,
      }),
    };
  }

  const slotLevel = input.slotLevel ?? input.spellLevel;
  assertSlotLevel(slotLevel);

  if (slotLevel < input.spellLevel) {
    throw new MagicServiceError(
      "SLOT_LEVEL_TOO_LOW",
      "slotLevel must be greater than or equal to spellLevel."
    );
  }

  const consumed = await persistSlotConsumption(db, character, slotLevel);

  return {
    ok: true,
    spellSlots: consumed.after,
    facts: buildFacts(input, character.id, {
      slotLevel,
      slotConsumed: true,
      spellSlotsBefore: consumed.before,
      spellSlotsAfter: consumed.after,
    }),
  };
}

export async function castSpell(input: CastSpellInput): Promise<CastSpellResult> {
  const db = resolveDb(input);

  if (input.tx || !db.$transaction) {
    return castSpellInTransaction(db, input);
  }

  return db.$transaction((tx) => castSpellInTransaction(tx, input));
}
