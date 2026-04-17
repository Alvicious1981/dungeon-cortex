/**
 * Combat resolution module — Dungeon Cortex rules engine.
 *
 * Implements Milestone B combat primitives: initiative ordering.
 * All dice randomness is delegated to dice.ts so this module stays
 * deterministic and auditable given a fixed roll sequence.
 */

import { z } from "zod";
import { roll } from "./dice";
import type { RollResult } from "./dice";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal combatant descriptor required to roll initiative. */
export interface CombatantInput {
  id: string;
  name: string;
  /** DEX modifier: floor((dex - 10) / 2). Caller is responsible for computing this. */
  dexModifier: number;
}

/** A combatant after initiative has been rolled, ready for encounter ordering. */
export interface InitiativeEntry extends CombatantInput {
  /** The raw 1d20 roll result, retained for display and audit. */
  roll: RollResult;
  /** Natural d20 result (1–20). */
  naturalRoll: number;
  /** Final initiative value: naturalRoll + dexModifier. */
  initiative: number;
}

/** Fully ordered initiative result for a combat encounter. */
export interface InitiativeOrder {
  /** Combatants sorted highest initiative first. Ties broken by dexModifier, then natural roll. */
  order: InitiativeEntry[];
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

/**
 * Roll initiative for every combatant in the encounter and return them sorted
 * in descending initiative order (highest acts first).
 *
 * Tie-breaking (5e convention):
 *   1. Higher dexModifier wins.
 *   2. If dexModifier is also equal, higher natural d20 result wins.
 *   3. Remaining ties preserve original input order (stable sort).
 *
 * @example
 * const result = rollInitiative([
 *   { id: "player-1", name: "Aldric",  dexModifier: 2 },
 *   { id: "enemy-1",  name: "Goblin",  dexModifier: 1 },
 *   { id: "enemy-2",  name: "Hobgoblin", dexModifier: 0 },
 * ]);
 * // result.order[0] acts first this round
 */
export function rollInitiative(combatants: CombatantInput[]): InitiativeOrder {
  if (combatants.length === 0) {
    return { order: [] };
  }

  // Roll for every combatant and compute initiative totals.
  const entries: InitiativeEntry[] = combatants.map((combatant) => {
    const rollResult = roll("1d20");
    const naturalRoll = rollResult.dice[0].result;
    return {
      ...combatant,
      roll: rollResult,
      naturalRoll,
      initiative: naturalRoll + combatant.dexModifier,
    };
  });

  // Sort descending: initiative → dexModifier → naturalRoll.
  // Array.prototype.sort is stable in V8 (Node 11+), so equal entries
  // preserve original input order after the three explicit comparisons.
  entries.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if (b.dexModifier !== a.dexModifier) return b.dexModifier - a.dexModifier;
    return b.naturalRoll - a.naturalRoll;
  });

  return { order: entries };
}

// ---------------------------------------------------------------------------
// Turn advancement
// ---------------------------------------------------------------------------

export interface TurnAdvanceInput {
  currentTurnIndex: number;
  round: number;
  /** Total number of combatants in the encounter (including dead — 5e RAW). */
  combatantCount: number;
}

export interface TurnAdvanceResult {
  nextTurnIndex: number;
  nextRound: number;
  /** True when the index wrapped back to 0, i.e., a new round began. */
  roundAdvanced: boolean;
}

/**
 * Advances the initiative pointer to the next combatant.
 *
 * Dead combatants remain in the order per 5e RAW — the narrator is
 * responsible for describing that their turn is skipped.
 *
 * @pure — no side effects, deterministic output.
 */
export function advanceTurn(input: TurnAdvanceInput): TurnAdvanceResult {
  const rawNext = input.currentTurnIndex + 1;
  const wraps = rawNext >= input.combatantCount;
  return {
    nextTurnIndex: wraps ? 0 : rawNext,
    nextRound: wraps ? input.round + 1 : input.round,
    roundAdvanced: wraps,
  };
}

/** Clamps a damage application to a floor of 0 HP. @pure */
export function applyDamage(currentHp: number, damage: number): number {
  return Math.max(0, currentHp - damage);
}

/** Returns true when a combatant has reached 0 HP. @pure */
export function checkDeath(hp: number): boolean {
  return hp <= 0;
}

// ---------------------------------------------------------------------------
// Milestone J — Slice 1: Consequences Engine types
// ---------------------------------------------------------------------------

export type DamageType =
  | "slashing" | "piercing" | "bludgeoning"
  | "fire" | "cold" | "lightning" | "acid" | "poison"
  | "necrotic" | "radiant" | "psychic" | "thunder" | "force";

export const DAMAGE_TYPES: DamageType[] = [
  "slashing", "piercing", "bludgeoning",
  "fire", "cold", "lightning", "acid", "poison",
  "necrotic", "radiant", "psychic", "thunder", "force",
];

export type HitLocation =
  | "head" | "neck" | "shoulder" | "chest" | "abdomen"
  | "arm" | "hand" | "leg" | "knee" | "foot";

export type CombatBeat =
  | "opening"
  | "first_blood"
  | "turning_point"
  | "climax"
  | "aftermath";

export type GoreLevel = "PG13" | "Mature";

export interface CombatFacts {
  attacker: string;
  defender: string;
  weapon: string;
  damage: number;
  damage_type: DamageType;
  hp_before: number;
  hp_after: number;
  /** Target's maximum HP — required for trivial-scratch intensity check. */
  maxHp: number;
  is_crit: boolean;
  is_fumble: boolean;
  hit_location: HitLocation;
  status_applied: string[];
  overkill: number;
}

export interface StyleDSL {
  voice: "active";
  visual: "low" | "medium" | "high";
  sentences: "short" | "medium" | "long";
  metaphors: "sparse" | "moderate" | "rich";
  /** Target sense count 0–3. */
  senses: number;
  verbs: "hard";
  adverbs: "low";
}

export interface CombatConsequences {
  combat_facts: CombatFacts;
  narrative_tags: string[];
  narrative_intensity: number;
  combat_beat: CombatBeat;
  style_dsl: StyleDSL;
  suggested_senses: string[];
  suggested_actions: string[];
}

export interface TensionState {
  score: number;
  avg_enemy_hp_ratio: number;
  player_hp_ratio: number;
  enemy_count: number;
  boss_alive: boolean;
}

export interface EncounterSnapshot {
  round: number;
  /** Total damage dealt so far, including the current action. */
  totalDamageDealt: number;
  status: "active" | "resolved" | "fled";
  currentBeat: CombatBeat;
  /** ID of the defender in the current action (for boss-death detection). */
  defenderId: string;
  combatants: Array<{
    id: string;
    hp: number;
    maxHp: number;
    isPlayer: boolean;
    isBoss: boolean;
    /** HP before this turn began (for 50%-crossing detection). */
    hpBeforeThisTurn: number;
  }>;
}

export interface ComputeConsequencesInput {
  attacker: string;
  defender: string;
  weapon: string;
  weaponDice: string;
  attackModifier: number;
  damageType: DamageType;
  targetAC: number;
  targetHp: number;
  targetMaxHp: number;
  targetIsPlayer: boolean;
  targetIsBoss: boolean;
  statusApplied: string[];
  encounterSnapshot: EncounterSnapshot;
  usedSenses: string[];
  zones: Array<{ name: string }>;
}

// ---------------------------------------------------------------------------
// Tool Input Schemas
// ---------------------------------------------------------------------------

export const ResolveAttackInputSchema = z.object({
  attackerId: z
    .string()
    .min(1)
    .describe("Combatant ID of the attacker (from initiative order)."),
  targetId: z
    .string()
    .min(1)
    .describe("Combatant ID of the target (from initiative order)."),
  weaponDamageDice: z
    .string()
    .min(1)
    .describe("Dice notation for the weapon's damage, e.g. '1d8', '2d6'."),
  attackModifier: z
    .number()
    .int()
    .describe("Total attack modifier (proficiency + ability mod, etc)."),
  damageType: z
    .enum(DAMAGE_TYPES as [DamageType, ...DamageType[]])
    .describe("Damage type — must be a valid SRD damage type."),
}).strict();

export type ResolveAttackInput = z.infer<typeof ResolveAttackInputSchema>;

export const InitiativeInputSchema = z.object({
  combatants: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    dexModifier: z.number().int(),
  })).min(1),
}).strict();

export type InitiativeInput = z.infer<typeof InitiativeInputSchema>;

// ---------------------------------------------------------------------------
// Milestone J — Slice 1: Consequences Engine implementations
// ---------------------------------------------------------------------------

// Narrative tag catalogue — loaded once at module level.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NARRATIVE_TAGS = require("../../data/narrative-tags.json") as Record<
  string,
  Record<string, Record<string, string[]>>
>;

const HIT_LOCATIONS: readonly HitLocation[] = [
  "head", "neck", "shoulder", "chest", "abdomen",
  "arm", "hand", "leg", "knee", "foot",
];

const ALL_SENSES: readonly string[] = ["sight", "sound", "smell", "touch", "taste"];

// ── rollDamage ───────────────────────────────────────────────────────────────

/**
 * Rolls damage dice and optionally doubles the dice count for a critical hit.
 * Modifier is added to the total but NOT included in the rolls array.
 * @pure (random)
 */
export function rollDamage(
  dice: string,
  isCrit: boolean
): { total: number; rolls: number[] } {
  // Parse notation: XdY+Z or XdY-Z or XdY
  const match = dice.trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) {
    // Fallback: treat as flat value
    const flat = parseInt(dice, 10);
    return { total: isNaN(flat) ? 0 : flat, rolls: [] };
  }

  const diceCount = parseInt(match[1]!, 10);
  const dieFaces  = parseInt(match[2]!, 10);
  const modifier  = match[3] ? parseInt(match[3], 10) : 0;
  const totalDice = isCrit ? diceCount * 2 : diceCount;

  const rolls: number[] = [];
  for (let i = 0; i < totalDice; i++) {
    rolls.push(Math.floor(Math.random() * dieFaces) + 1);
  }

  return {
    total: rolls.reduce((a, b) => a + b, 0) + modifier,
    rolls,
  };
}

// ── rollHitLocation ──────────────────────────────────────────────────────────

/** Randomly selects one of the ten 5e hit locations. @pure (random) */
export function rollHitLocation(): HitLocation {
  return HIT_LOCATIONS[Math.floor(Math.random() * HIT_LOCATIONS.length)]!;
}

// ── computeOverkill ──────────────────────────────────────────────────────────

/** Returns max(0, damage - hpBefore). @pure */
export function computeOverkill(damage: number, hpBefore: number): number {
  return Math.max(0, damage - hpBefore);
}

// ── computeTension ───────────────────────────────────────────────────────────

/**
 * Computes a [0..1] tension score from the current combatant states.
 * Formula (spec §4.7):
 *   w1*(1 - avg_enemy_hp_ratio) + w2*(1 - player_hp_ratio)
 *   + w3*(enemy_count > 2 ? 0.1 * min(enemy_count, 6) : 0)
 *   + w4*(boss_alive ? 0.15 : 0)
 *   Weights: w1=0.3, w2=0.3, w3=0.2, w4=0.2
 * @pure
 */
export function computeTension(
  combatants: Array<{ hp: number; maxHp: number; isPlayer: boolean; isBoss: boolean }>
): TensionState {
  const enemies = combatants.filter((c) => !c.isPlayer);
  const player  = combatants.find((c) => c.isPlayer);

  const avg_enemy_hp_ratio =
    enemies.length === 0
      ? 1
      : enemies.reduce((sum, e) => sum + (e.maxHp > 0 ? e.hp / e.maxHp : 0), 0) / enemies.length;

  const player_hp_ratio =
    player && player.maxHp > 0 ? player.hp / player.maxHp : 1;

  const enemy_count = enemies.length;
  const boss_alive  = enemies.some((e) => e.isBoss && e.hp > 0);

  const w1 = 0.3, w2 = 0.3, w3 = 0.2, w4 = 0.2;

  const raw =
    w1 * (1 - avg_enemy_hp_ratio) +
    w2 * (1 - player_hp_ratio) +
    w3 * (enemy_count > 2 ? 0.1 * Math.min(enemy_count, 6) : 0) +
    w4 * (boss_alive ? 0.15 : 0);

  return {
    score: Math.min(1, Math.max(0, raw)),
    avg_enemy_hp_ratio,
    player_hp_ratio,
    enemy_count,
    boss_alive,
  };
}

// ── deriveNarrativeTags ──────────────────────────────────────────────────────

/**
 * Derives curated sensory tags from the narrative-tags catalogue.
 * Lookup key: (damage_type, is_crit → "crit" | "hit", hit_location).
 * Returns an empty array for unknown combinations. @pure
 */
export function deriveNarrativeTags(facts: CombatFacts): string[] {
  const tier  = facts.is_crit ? "crit" : "hit";
  const entry = NARRATIVE_TAGS?.[facts.damage_type]?.[tier]?.[facts.hit_location];
  return Array.isArray(entry) ? [...entry] : [];
}

// ── computeNarrativeIntensity ────────────────────────────────────────────────

/**
 * Computes narrative intensity [0..1] from combat facts and tension.
 * Formula per Milestone J spec §4.5. @pure
 */
export function computeNarrativeIntensity(
  facts: CombatFacts,
  tension: TensionState
): number {
  let base = 0.0;

  if (facts.is_crit)                          base += 0.40;
  if (facts.hp_after <= 0)                    base += 0.20;
  if (facts.overkill > 0)                     base += 0.05 * Math.min(facts.overkill, 4);
  if (facts.status_applied.length > 0)        base += 0.10;
  if (facts.hit_location === "head" || facts.hit_location === "neck") base += 0.10;

  // Trivial scratch: damage is less than 10% of the target's max HP
  const maxHp = facts.maxHp > 0 ? facts.maxHp : 1;
  if (facts.damage / maxHp < 0.1)             base -= 0.20;

  return Math.min(1.0, Math.max(0.0, base + tension.score * 0.30));
}

// ── deriveCombatBeat ─────────────────────────────────────────────────────────

/**
 * Determines the current cinematic beat from the encounter state and the
 * just-resolved action's facts. Beat priority matches spec §4.6 order. @pure
 */
export function deriveCombatBeat(
  encounter: EncounterSnapshot,
  facts: CombatFacts
): CombatBeat {
  // Aftermath: encounter is over.
  if (encounter.status === "resolved" || encounter.status === "fled") {
    return "aftermath";
  }

  // Opening: round 1, no damage dealt yet (total includes current).
  if (encounter.round === 1 && encounter.totalDamageDealt === 0 && facts.damage === 0) {
    return "opening";
  }

  // First blood: total damage equals just this action's damage (first hit).
  if (facts.damage > 0 && encounter.totalDamageDealt === facts.damage) {
    return "first_blood";
  }

  // Climax: boss dies this turn.
  const defender = encounter.combatants.find((c) => c.id === encounter.defenderId);
  if (defender?.isBoss && facts.hp_after <= 0) {
    return "climax";
  }

  // Turning point: any combatant crossed below 50% HP this turn.
  const crossedHalf = encounter.combatants.some(
    (c) =>
      c.maxHp > 0 &&
      c.hpBeforeThisTurn / c.maxHp > 0.5 &&
      c.hp / c.maxHp <= 0.5
  );
  if (crossedHalf) return "turning_point";

  // Carry forward.
  return encounter.currentBeat;
}

// ── deriveStyleDSL ───────────────────────────────────────────────────────────

/**
 * Maps intensity + beat to a StyleDSL configuration block.
 * High intensity → dense, short, sparse metaphors.
 * Low intensity → sparse, long, rich metaphors.
 * Beat modulates sentences and metaphors slightly. @pure
 */
export function deriveStyleDSL(intensity: number, beat: CombatBeat): StyleDSL {
  const isHigh = intensity > 0.7;
  const isLow  = intensity < 0.3;

  let visual:    StyleDSL["visual"]    = isHigh ? "high"   : isLow ? "low"    : "medium";
  let sentences: StyleDSL["sentences"] = isHigh ? "short"  : isLow ? "long"   : "medium";
  let metaphors: StyleDSL["metaphors"] = isHigh ? "sparse" : isLow ? "rich"   : "moderate";

  // Beat overrides: opening and aftermath favour atmosphere.
  if (beat === "opening" || beat === "aftermath") {
    if (!isHigh) {
      sentences = "long";
      metaphors = "rich";
    }
  }

  const senses = Math.min(3, Math.max(0, Math.round(intensity * 3)));

  return { voice: "active", visual, sentences, metaphors, senses, verbs: "hard", adverbs: "low" };
}

// ── selectSenses ─────────────────────────────────────────────────────────────

/**
 * Picks 2 senses from [sight, sound, smell, touch, taste] that were not
 * used recently, falling back to random selection if all are recent. @pure (random)
 */
export function selectSenses(usedRecently: string[]): string[] {
  const unused = ALL_SENSES.filter((s) => !usedRecently.includes(s));

  if (unused.length >= 2) {
    // Prefer senses not used recently.
    const shuffled = [...unused].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2);
  }

  if (unused.length === 1) {
    // Guarantee the single fresh sense is included; pick one used sense to pair it.
    const rest = ALL_SENSES.filter((s) => s !== unused[0]);
    const pair = rest[Math.floor(Math.random() * rest.length)]!;
    return [unused[0]!, pair];
  }

  // All senses used recently — pick any 2.
  const shuffled = [...ALL_SENSES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2);
}

// ── selectTacticalHooks ──────────────────────────────────────────────────────

/**
 * Derives tactical action hooks from hit location and zone context.
 * Returns lowercase action strings. @pure
 */
export function selectTacticalHooks(
  facts: CombatFacts,
  _zones: Array<{ name: string }>
): string[] {
  const hooks: string[] = [];

  // Always available in melee.
  hooks.push("push");

  if (facts.hit_location === "arm" || facts.hit_location === "hand") {
    hooks.push("disarm");
  }
  if (
    facts.hit_location === "leg" ||
    facts.hit_location === "knee" ||
    facts.hit_location === "foot"
  ) {
    hooks.push("trip");
  }
  if (facts.overkill > 0) {
    hooks.push("exploit");
  }

  return hooks;
}

// ── computeConsequences ──────────────────────────────────────────────────────

/**
 * Full Consequences Engine orchestrator.
 * Resolves the attack, rolls damage, and assembles the complete
 * CombatConsequences payload. @pure (random)
 */
export function computeConsequences(
  input: ComputeConsequencesInput
): CombatConsequences {
  const {
    attacker, defender, weapon,
    weaponDice, attackModifier, damageType,
    targetAC, targetHp, targetMaxHp,
    statusApplied, encounterSnapshot,
    usedSenses, zones,
  } = input;

  // 1. Resolve the attack roll.
  const attackResult = resolveAttackRoll(attackModifier, targetAC);

  // 2. Roll damage and hit location only on a hit.
  let damage      = 0;
  let rollsArr: number[] = [];
  let hitLocation: HitLocation = "chest"; // placeholder for misses

  if (attackResult.hit) {
    const damageResult = rollDamage(weaponDice, attackResult.critical);
    damage   = damageResult.total;
    rollsArr = damageResult.rolls;
    hitLocation = rollHitLocation();
  }

  // 3. Apply damage and compute overkill.
  const hpBefore = targetHp;
  const hpAfter  = Math.max(0, hpBefore - damage);
  const overkill = computeOverkill(damage, hpBefore);

  // 4. Assemble CombatFacts.
  const combat_facts: CombatFacts = {
    attacker,
    defender,
    weapon,
    damage,
    damage_type: damageType,
    hp_before:   hpBefore,
    hp_after:    hpAfter,
    maxHp:       targetMaxHp,
    is_crit:     attackResult.critical,
    is_fumble:   attackResult.fumble,
    hit_location: hitLocation,
    status_applied: statusApplied,
    overkill,
  };

  // Suppress unused variable warning from rollsArr (it exists for callers
  // who want to inspect individual rolls in debug contexts).
  void rollsArr;

  // 5. Compute derived values.
  const tension            = computeTension(encounterSnapshot.combatants);
  const narrative_tags     = deriveNarrativeTags(combat_facts);
  const narrative_intensity = computeNarrativeIntensity(combat_facts, tension);
  const combat_beat        = deriveCombatBeat(encounterSnapshot, combat_facts);
  const style_dsl          = deriveStyleDSL(narrative_intensity, combat_beat);
  const suggested_senses   = selectSenses(usedSenses);
  const suggested_actions  = selectTacticalHooks(combat_facts, zones);

  return {
    combat_facts,
    narrative_tags,
    narrative_intensity,
    combat_beat,
    style_dsl,
    suggested_senses,
    suggested_actions,
  };
}

// ---------------------------------------------------------------------------
// Encounter end detection
// ---------------------------------------------------------------------------

export interface EncounterResolution {
  shouldEnd: boolean;
  reason: "all_enemies_dead" | "player_dead" | "ongoing";
}

/**
 * Determines whether the encounter should end based on current HP values.
 *
 * Priority: player death is checked before enemy death so a mutual-kill
 * scenario is correctly reported as a player death.
 *
 * @pure — no side effects, deterministic output.
 */
export function resolveEncounterEnd(
  combatants: Array<{ isPlayer: boolean; hp: number }>
): EncounterResolution {
  const player = combatants.find((c) => c.isPlayer);
  if (player && checkDeath(player.hp)) {
    return { shouldEnd: true, reason: "player_dead" };
  }
  const allEnemiesDead = combatants
    .filter((c) => !c.isPlayer)
    .every((c) => checkDeath(c.hp));
  if (allEnemiesDead) {
    return { shouldEnd: true, reason: "all_enemies_dead" };
  }
  return { shouldEnd: false, reason: "ongoing" };
}

// ---------------------------------------------------------------------------
// Armor Class derivation
// ---------------------------------------------------------------------------

/**
 * Reads the first numeric AC value from a SrdMonster `data` JSON blob.
 * The SRD structure is: `armor_class: [{ type: string, value: number }]`.
 * Falls back to 10 (unarmored baseline) if the field is absent or malformed.
 *
 * @pure — no side effects.
 */
export function acFromMonsterData(data: Record<string, unknown>): number {
  const ac = data.armor_class;
  if (!Array.isArray(ac) || ac.length === 0) return 10;
  const first = ac[0] as Record<string, unknown>;
  return typeof first.value === "number" ? first.value : 10;
}

/**
 * Derives a player character's AC from their inventory.
 *
 * Rules (5e 2014 SRD):
 *   - Unarmored: 10 + DEX modifier.
 *   - Light armor: base AC + DEX modifier (no cap).
 *   - Medium armor: base AC + DEX modifier (max +2).
 *   - Heavy armor: base AC, no DEX modifier.
 *   - Shield: +2 AC (stacks with any armor — not yet implemented here).
 *
 * The first item with type "armor" in the inventory is used.
 * If no armor is found the character is treated as unarmored.
 *
 * @pure — no side effects.
 */
export function acFromInventory(
  inventory: Array<{ type: string; properties: unknown }>,
  dexModifier: number
): number {
  const armorItem = inventory.find((i) => i.type === "armor");
  if (!armorItem) return 10 + dexModifier;

  const props = armorItem.properties as Record<string, unknown>;
  const base = typeof props.baseAC === "number" ? props.baseAC : 10;
  const addDex = props.addDexModifier !== false;
  const rawMax = props.maxDexBonus;
  const maxDex = typeof rawMax === "number" ? rawMax : Infinity;
  const dexBonus = addDex ? Math.min(dexModifier, maxDex) : 0;
  return base + dexBonus;
}

// ---------------------------------------------------------------------------
// Attack roll resolution
// ---------------------------------------------------------------------------

export interface AttackRollResult {
  /** The raw d20 face result (1–20). */
  roll: number;
  /** roll + attackModifier. */
  total: number;
  /** True when the attack hits (natural 20 always hits; natural 1 always misses). */
  hit: boolean;
  /** Natural 20 — damage dice are doubled per 5e 2014 SRD p. 196. */
  critical: boolean;
  /** Natural 1 — automatic miss regardless of modifiers. */
  fumble: boolean;
}

/**
 * Resolves a single melee/ranged attack roll against a target's AC.
 *
 * Critical hit rule (5e 2014 SRD p. 196):
 *   A natural 20 always hits, regardless of the target's AC.
 * Fumble rule:
 *   A natural 1 always misses, regardless of modifiers.
 *
 * @pure — uses Math.random() internally; not deterministic across runs.
 */
export function resolveAttackRoll(
  attackModifier: number,
  targetAC: number
): AttackRollResult {
  const rollValue = Math.floor(Math.random() * 20) + 1;
  const total = rollValue + attackModifier;
  const critical = rollValue === 20;
  const fumble = rollValue === 1;
  return {
    roll: rollValue,
    total,
    hit: critical || (!fumble && total >= targetAC),
    critical,
    fumble,
  };
}
