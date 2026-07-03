import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
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
  | "INVALID_SPELL_SLOTS";

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
  campaignId?: string;
  spellSlots: unknown;
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
    select: { id: true, campaignId: true, spellSlots: true },
  });

  if (!character) {
    throw new MagicServiceError(
      "CHARACTER_NOT_FOUND",
      `Character not found: ${characterId}`
    );
  }

  if (
    (campaign.characterId && campaign.characterId !== character.id) ||
    (character.campaignId && character.campaignId !== input.campaignId)
  ) {
    throw new MagicServiceError(
      "CHARACTER_CAMPAIGN_MISMATCH",
      `Character ${character.id} does not belong to campaign ${input.campaignId}.`
    );
  }

  return character;
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

async function castSpellInTransaction(
  db: MagicDb,
  input: CastSpellInput
): Promise<CastSpellResult> {
  assertSpellLevel(input.spellLevel);

  const campaign = await resolveCampaign(db, input);
  const character = await resolveCharacter(db, input, campaign);
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

  assertValidSlots(character.spellSlots);

  if (!hasAvailableSlot(character.spellSlots, slotLevel)) {
    throw new MagicServiceError(
      "NO_SPELL_SLOT_AVAILABLE",
      `No available spell slots remaining at level ${slotLevel}.`
    );
  }

  const updatedSlots = consumeSlot(character.spellSlots, slotLevel);
  const updatedCharacter = await db.character.update({
    where: { id: character.id },
    data: { spellSlots: updatedSlots as unknown as Prisma.InputJsonValue },
    select: { spellSlots: true },
  });

  const spellSlotsAfter = isSpellSlots(updatedCharacter.spellSlots)
    ? updatedCharacter.spellSlots
    : updatedSlots;

  return {
    ok: true,
    spellSlots: spellSlotsAfter,
    facts: buildFacts(input, character.id, {
      slotLevel,
      slotConsumed: true,
      spellSlotsBefore: character.spellSlots,
      spellSlotsAfter,
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