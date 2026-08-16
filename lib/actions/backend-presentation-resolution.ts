/**
 * lib/actions/backend-presentation-resolution.ts
 *
 * Derives the level-up presentation a turn is allowed to show, from canonical
 * persisted state only (SEC-AI-001 PR3, Model E).
 *
 * Three properties hold for everything in this module:
 *
 *   1. It is READ-ONLY. No function here writes to the database.
 *   2. It takes NO input from the client, the player's text, the narrator, or
 *      memory. The only argument is the character record the caller already
 *      read.
 *   3. It never applies a level-up. Detection and application are separate
 *      operations: `applyLevelUp` (lib/rules/level-up-service.ts) is the single
 *      authority that may mutate, inside its own transaction and behind its
 *      own guards. This module only reports that the state permits one.
 *
 * Model E: `character.level` is the last MECHANICALLY APPLIED level.
 * `targetLevel = getLevelFromXP(xp)` may run ahead of it by any number of
 * levels. Detection always reports the single next physical step
 * (`fromLevel -> fromLevel + 1`) together with `targetLevel` and
 * `pendingLevels`, so a caller can tell "one ascension away" from "three
 * ascensions away" without ever being handed a multi-level jump to apply.
 */

import { z } from "zod";
import {
  getLevelFromXP,
  HIT_DIE_MAP,
  MAX_LEVEL,
  MIN_LEVEL,
} from "@/lib/rules/progression";

// ─── Presentation payload contract ───────────────────────────────────────────

/**
 * Validates the level-up presentation before it leaves this module.
 *
 * Deliberately has no hpRoll/hpGained/newMaxHp/newHitDiceTotal: those are
 * outcomes of `applyLevelUp`, not of detection. A schema that cannot express
 * them cannot accidentally carry invented ones.
 */
export const LevelUpAvailablePayloadSchema = z.object({
  characterId:         z.string().min(1),
  className:           z.string().min(1),
  hitDie:              z.string().regex(/^1d\d+$/),
  /** Level already mechanically applied — the base this step advances from. */
  fromLevel:           z.number().int().min(MIN_LEVEL).max(MAX_LEVEL - 1),
  /** Always fromLevel + 1: applyLevelUp resolves exactly one level per call. */
  toLevel:             z.number().int().min(MIN_LEVEL + 1).max(MAX_LEVEL),
  /** getLevelFromXP(xp) — the level the persisted XP supports. */
  targetLevel:         z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
  /** targetLevel - fromLevel. Always >= 1 when this payload exists. */
  pendingLevels:       z.number().int().min(1),
  conModifier:         z.number().int(),
  /** Current persisted maximum hit points — unchanged by this detection. */
  currentMaxHp:        z.number().int().min(1),
  /** Current persisted hit-dice total — unchanged by this detection. */
  currentHitDiceTotal: z.number().int().min(1),
  /** Always true: no mutation happens until the player confirms. */
  requiresPlayerConfirmation: z.literal(true),
});

export type LevelUpAvailablePayload = z.infer<typeof LevelUpAvailablePayloadSchema>;

// ─── Input surface ────────────────────────────────────────────────────────────

/**
 * The character fields detection needs. Structural, not a Prisma type, so
 * callers can pass either a live record or a plain test object.
 */
export interface BackendPresentationCharacterRecord {
  id: string;
  class: string;
  level: number;
  xp: number;
  maxHp: number;
  hitDiceTotal: number;
  stats: unknown;
}

// ─── Level-up detection ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Same derivation `applyLevelUp` uses, so presentation and application agree. */
function getConstitutionModifier(stats: unknown): number {
  const source = isRecord(stats) ? stats : {};
  const constitution =
    typeof source.CON === "number"
      ? source.CON
      : typeof source.constitution === "number"
        ? source.constitution
        : 10;

  return Math.floor((constitution - 10) / 2);
}

/**
 * Reports whether canonical state currently holds a level-up awaiting its
 * physical application.
 *
 * The predicate is the exact Model E settled-state precondition `applyLevelUp`
 * enforces: `hitDiceTotal === level` (the row was last resolved cleanly),
 * `level < MAX_LEVEL`, and the persisted XP supports a level beyond the one
 * already applied. Level thresholds come from `getLevelFromXP`; this module
 * does not restate the table.
 *
 * Returning null on inconsistent or ambiguous state is intentional — the
 * honest response to state this module cannot vouch for is to present
 * nothing, never to guess or to widen the jump.
 *
 * @pure — no I/O, no mutation.
 */
export function detectPendingLevelUp(
  character: BackendPresentationCharacterRecord,
): LevelUpAvailablePayload | null {
  if (!Number.isInteger(character.xp) || character.xp < 0) return null;
  if (
    !Number.isInteger(character.level) ||
    character.level < MIN_LEVEL ||
    character.level > MAX_LEVEL
  ) {
    return null;
  }
  if (!Number.isInteger(character.hitDiceTotal) || character.hitDiceTotal < 0) return null;
  if (!Number.isInteger(character.maxHp) || character.maxHp < 1) return null;

  // Model E settled state. applyLevelUp only ever leaves a row with
  // hitDiceTotal === level; any disagreement is old-contract residue or
  // corruption, and this module cannot trust it as a detection base.
  if (character.hitDiceTotal !== character.level) return null;

  // Already at the level cap — nothing can be pending.
  if (character.level >= MAX_LEVEL) return null;

  const targetLevel = getLevelFromXP(character.xp);
  const pendingLevels = targetLevel - character.level;

  // No ascension earned yet.
  if (pendingLevels <= 0) return null;

  const className = character.class;
  if (!(className in HIT_DIE_MAP)) return null;

  const fromLevel = character.level;
  const toLevel = fromLevel + 1;

  const payload: LevelUpAvailablePayload = {
    characterId:         character.id,
    className,
    hitDie:              `1d${HIT_DIE_MAP[className as keyof typeof HIT_DIE_MAP]}`,
    fromLevel,
    toLevel,
    targetLevel,
    pendingLevels,
    conModifier:         getConstitutionModifier(character.stats),
    currentMaxHp:        character.maxHp,
    currentHitDiceTotal: character.hitDiceTotal,
    requiresPlayerConfirmation: true,
  };

  const parsed = LevelUpAvailablePayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
