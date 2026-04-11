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
      return { type: "healing", dice, damageType: null, hasSavingThrow: false, saveAbility: null };
    }
  }

  // --- Utility spell ---
  return { type: "utility", dice: null, damageType: null, hasSavingThrow: false, saveAbility: null };
}
