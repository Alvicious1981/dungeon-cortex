/**
 * lib/rules/magic.ts
 *
 * Pure rules functions for spell slot management (Milestone C — Magic and state depth).
 *
 * SpellSlots is the canonical in-memory representation of the `spellSlots Json?`
 * field on the Character model. Keys are spell level as a string ("1"–"9");
 * values track current available slots and the per-long-rest maximum.
 *
 * These functions are pure: they never touch the database. Callers are
 * responsible for persisting the returned state via prisma.character.update.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-level slot entry stored inside the SpellSlots record. */
export interface SlotEntry {
  /** Slots currently available (0 ≤ current ≤ max). */
  current: number;
  /** Maximum slots granted at this spell level. */
  max: number;
}

/**
 * Canonical shape of Character.spellSlots.
 * Keys are spell level as a string, e.g. "1", "2", … "9".
 * Cantrips (level 0) are unlimited and must not appear here.
 *
 * Example: { "1": { current: 2, max: 2 }, "2": { current: 1, max: 1 } }
 */
export type SpellSlots = Record<string, SlotEntry>;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Narrows an unknown value (e.g. Prisma JsonValue) to SpellSlots. */
export function isSpellSlots(value: unknown): value is SpellSlots {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, entry]) => {
    if (!/^\d+$/.test(key)) return false;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    return typeof e.current === "number" && typeof e.max === "number";
  });
}

// ---------------------------------------------------------------------------
// Pure rule functions
// ---------------------------------------------------------------------------

/**
 * Returns true if the character has at least one available slot at `level`.
 * Safe to call with null/undefined (characters without spellcasting ability).
 */
export function hasAvailableSlot(
  slots: SpellSlots | null | undefined,
  level: number
): boolean {
  if (!slots) return false;
  const key = String(level);
  const entry = slots[key];
  return entry !== undefined && entry.current > 0;
}

/**
 * Decrements the `current` count for the given spell level and returns the
 * updated SpellSlots object. The original object is not mutated.
 *
 * Throws if:
 * - the level has no entry in slots, or
 * - `current` is already 0 (no slots remaining).
 */
export function consumeSlot(slots: SpellSlots, level: number): SpellSlots {
  const key = String(level);
  const entry = slots[key];

  if (entry === undefined) {
    throw new Error(
      `No spell slot entry found for level ${level}. ` +
      `Available levels: ${Object.keys(slots).join(", ") || "none"}.`
    );
  }
  if (entry.current <= 0) {
    throw new Error(
      `No available spell slots remaining at level ${level} ` +
      `(max: ${entry.max}).`
    );
  }

  return {
    ...slots,
    [key]: { ...entry, current: entry.current - 1 },
  };
}

/**
 * Restores all spell slots to their maximum values (long rest).
 * Returns a new SpellSlots object; the original is not mutated.
 */
export function restoreAllSlots(slots: SpellSlots): SpellSlots {
  return Object.fromEntries(
    Object.entries(slots).map(([key, entry]) => [key, { ...entry, current: entry.max }])
  );
}

// ---------------------------------------------------------------------------
// Spell slot tables — 5e 2014 SRD
// ---------------------------------------------------------------------------

/**
 * Full-caster spell slot table (Bard, Cleric, Druid, Sorcerer, Wizard).
 * Each row is indexed by character level (1-based). Each row contains 9
 * values representing available slots at spell levels 1–9.
 *
 * Source: Player's Handbook 2014, class spell-slot tables.
 */
const FULL_CASTER_SLOTS: readonly (readonly number[])[] = [
  //  1   2   3   4   5   6   7   8   9
  [2, 0, 0, 0, 0, 0, 0, 0, 0], // level 1
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // level 2
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // level 3
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // level 4
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // level 5
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // level 6
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // level 7
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // level 8
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // level 9
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // level 10
  [4, 3, 3, 3, 2, 1, 0, 0, 0], // level 11
  [4, 3, 3, 3, 2, 1, 0, 0, 0], // level 12
  [4, 3, 3, 3, 2, 1, 1, 0, 0], // level 13
  [4, 3, 3, 3, 2, 1, 1, 0, 0], // level 14
  [4, 3, 3, 3, 2, 1, 1, 1, 0], // level 15
  [4, 3, 3, 3, 2, 1, 1, 1, 0], // level 16
  [4, 3, 3, 3, 2, 1, 1, 1, 1], // level 17
  [4, 3, 3, 3, 3, 1, 1, 1, 1], // level 18
  [4, 3, 3, 3, 3, 2, 1, 1, 1], // level 19
  [4, 3, 3, 3, 3, 2, 2, 1, 1], // level 20
] as const;

/**
 * Half-caster spell slot table (Paladin, Ranger).
 * Spellcasting begins at level 2. Slots cap at spell level 5.
 */
const HALF_CASTER_SLOTS: readonly (readonly number[])[] = [
  //  1   2   3   4   5   6   7   8   9
  [0, 0, 0, 0, 0, 0, 0, 0, 0], // level 1
  [2, 0, 0, 0, 0, 0, 0, 0, 0], // level 2
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // level 3
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // level 4
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // level 5
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // level 6
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // level 7
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // level 8
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // level 9
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // level 10
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // level 11
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // level 12
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // level 13
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // level 14
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // level 15
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // level 16
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // level 17
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // level 18
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // level 19
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // level 20
] as const;

/**
 * Warlock Pact Magic table. All slots are the same level (pact slot level),
 * mapped into the 9-element array at the correct index (slot_level - 1).
 * Short-rest recovery is a concern for the rest API, not this table.
 *
 * Format: [slotCount, pactSlotLevel] per character level.
 */
const WARLOCK_PACT: readonly [number, number][] = [
  [1, 1], // level 1
  [2, 1], // level 2
  [2, 2], // level 3
  [2, 2], // level 4
  [2, 3], // level 5
  [2, 3], // level 6
  [2, 4], // level 7
  [2, 4], // level 8
  [2, 5], // level 9
  [2, 5], // level 10
  [3, 5], // level 11
  [3, 5], // level 12
  [3, 5], // level 13
  [3, 5], // level 14
  [3, 5], // level 15
  [3, 5], // level 16
  [4, 5], // level 17
  [4, 5], // level 18
  [4, 5], // level 19
  [4, 5], // level 20
] as const;

const ZERO_SLOTS: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0] as const;

/**
 * Returns the 5e SRD spell slot array (9 elements, indices 0–8 = spell levels 1–9)
 * for the given class and character level.
 *
 * Non-casters (barbarian, fighter, monk, rogue) return all zeros.
 * Unknown classes are treated as non-casters.
 *
 * @throws {RangeError} if `level` is outside [1, 20].
 * @pure — deterministic, no side effects.
 */
export function spellSlotsForLevel(
  characterClass: string,
  level: number
): number[] {
  if (level < 1 || level > 20) {
    throw new RangeError(
      `Character level must be between 1 and 20; got ${level}.`
    );
  }

  const idx = level - 1; // 0-based table index

  switch (characterClass.toLowerCase()) {
    // --- Full casters ---
    case "bard":
    case "cleric":
    case "druid":
    case "sorcerer":
    case "wizard":
      return [...FULL_CASTER_SLOTS[idx]];

    // --- Half casters ---
    case "paladin":
    case "ranger":
      return [...HALF_CASTER_SLOTS[idx]];

    // --- Warlock (Pact Magic) ---
    case "warlock": {
      const [count, slotLevel] = WARLOCK_PACT[idx];
      const row = [...ZERO_SLOTS] as number[];
      row[slotLevel - 1] = count;
      return row;
    }

    // --- Non-casters and unrecognised classes ---
    default:
      return [...ZERO_SLOTS];
  }
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

/** Minimal character shape required to manage concentration state. */
export interface ConcentrationTarget {
  concentrationSpellId: string | null;
}

/**
 * Returns a new character-like object with `concentrationSpellId` cleared.
 * Call this whenever concentration is broken (damage, new concentration spell,
 * rest, or explicit dispel).
 *
 * The original object is never mutated.
 *
 * @pure — deterministic, no side effects.
 */
export function breakConcentration<T extends ConcentrationTarget>(
  character: T
): T {
  return { ...character, concentrationSpellId: null };
}

/**
 * Returns a new character-like object with `concentrationSpellId` set to
 * `spellId`, replacing any prior concentration.
 *
 * Callers must ensure `spellId` is a valid spell identifier before calling.
 *
 * @pure — deterministic, no side effects.
 */
export function beginConcentration<T extends ConcentrationTarget>(
  character: T,
  spellId: string
): T {
  return { ...character, concentrationSpellId: spellId };
}

// ---------------------------------------------------------------------------
// Spell effect resolution
// ---------------------------------------------------------------------------

export type SpellEffectType = "damage" | "healing" | "utility";

export interface SpellEffect {
  type: SpellEffectType;
  /**
   * Dice expression ready to pass to roll(), e.g. "8d6" or "1d8+3".
   * Null for utility spells or when no mechanical dice are present.
   */
  dice: string | null;
  /** Damage type index (e.g. "fire", "cold"). Null for non-damage effects. */
  damageType: string | null;
  /** True when the spell grants a saving throw (damage may be halved on success). */
  hasSavingThrow: boolean;
  /** Ability score index for the saving throw, e.g. "dex". Null if none. */
  saveAbility: string | null;
  /** Condition to apply on failed save (or non-save spells), e.g. "Blinded". Null if none. */
  condition: string | null;
}

/**
 * Returns the canonical spellcasting ability ("INT" | "WIS" | "CHA") for a
 * given D&D 5e 2014 class. Used to substitute "APT" in Spanish SRD formulas.
 *
 * "APT" is the Spanish SRD abbreviation for the caster's spellcasting ability
 * modifier (English "spellcasting ability modifier").
 *
 * @pure — deterministic, no side effects.
 */
export function spellcastingAbility(characterClass: string): "INT" | "WIS" | "CHA" {
  switch (characterClass.toLowerCase()) {
    case "wizard":
    case "artificer":
      return "INT";
    case "cleric":
    case "druid":
    case "ranger":
      return "WIS";
    default:
      // bard, sorcerer, warlock, paladin
      return "CHA";
  }
}

/**
 * Extracts the mechanical effect of a spell cast at the given slot level from
 * a raw SrdSpell data blob (Spanish 5e SRD format).
 *
 * Data fields read:
 *   - `damage.damage_at_slot_level[slotLevel]`  → leveled damage dice
 *   - `heal_at_slot_level[slotLevel]`            → leveled healing dice (may contain "APT")
 *   - `dc.dc_type.index`                         → saving throw ability
 *   - `dc.dc_success`                            → "mitad" = half damage on save
 *
 * "APT" in healing formulas is replaced with the numeric `spellcastingMod`
 * so the result is a valid dice expression (e.g. "1d8+3").
 *
 * @pure — no side effects, deterministic for the same inputs.
 */
export function resolveSpellEffect(
  spellData: Record<string, unknown>,
  slotLevel: number,
  spellcastingMod: number
): SpellEffect {
  // --- Damage spell ---
  const dmg = spellData.damage as Record<string, unknown> | undefined;
  if (dmg) {
    const bySlot = dmg.damage_at_slot_level as Record<string, string> | undefined;
    if (bySlot) {
      const key = String(slotLevel);
      // Fall back to the lowest available tier if exact slot level is missing
      const keys = Object.keys(bySlot).map(Number).sort((a, b) => a - b);
      const bestKey = keys.includes(slotLevel) ? slotLevel : (keys[0] ?? slotLevel);
      const dice = bySlot[String(bestKey)] ?? null;

      const dmgType = (dmg.damage_type as Record<string, unknown> | undefined)?.index as string ?? null;
      const dc = spellData.dc as Record<string, unknown> | undefined;
      const dcType = dc ? ((dc.dc_type as Record<string, unknown> | undefined)?.index as string ?? null) : null;

      return {
        type: "damage",
        dice,
        damageType: dmgType,
        hasSavingThrow: !!dc,
        saveAbility: dcType,
        condition: null, // To be extracted from SRD description or specialized fields
      };
    }
  }

  // --- Healing spell ---
  const healBySlot = spellData.heal_at_slot_level as Record<string, string> | undefined;
  if (healBySlot) {
    const raw = healBySlot[String(slotLevel)] ?? null;
    if (raw) {
      // Replace "APT" (Spanish spellcasting modifier abbreviation) with the
      // numeric modifier so the string is a valid dice expression.
      const modStr = spellcastingMod >= 0 ? `+${spellcastingMod}` : String(spellcastingMod);
      // Handles " + APT", "+APT", and bare "APT"
      const dice = raw
        .replace(/\s*\+\s*APT\b/gi, modStr)
        .replace(/\bAPT\b/gi, String(spellcastingMod))
        .replace(/\s+/g, ""); // strip remaining whitespace for dice parser
      return { type: "healing", dice, damageType: null, hasSavingThrow: false, saveAbility: null, condition: null };
    }
  }

  // --- Utility spell ---
  return { type: "utility", dice: null, damageType: null, hasSavingThrow: false, saveAbility: null, condition: null };
}

/**
 * Returns the 5e proficiency bonus for a character of the given level.
 * Formula: floor((level - 1) / 4) + 2.
 * Range: [+2 .. +6].
 *
 * @pure — deterministic, no side effects.
 */
export function calculateProficiency(level: number): number {
  return Math.floor((level - 1) / 4) + 2;
}

/**
 * Calculates the Spell Save DC for a caster.
 * Formula: 8 + Spellcasting Ability Modifier + Proficiency Bonus.
 *
 * @pure — deterministic, no side effects.
 */
export function calculateSpellSaveDC(
  abilityMod: number,
  proficiencyBonus: number
): number {
  return 8 + abilityMod + proficiencyBonus;
}
