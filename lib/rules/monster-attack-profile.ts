/**
 * lib/rules/monster-attack-profile.ts
 *
 * The SRD monster attacks this engine can resolve, recognised verbatim.
 *
 * @pure — no database, no I/O, no randomness, and never throws.
 *
 * ─── Why a table and not a parser ────────────────────────────────────────────
 * The same discipline as `damage-clauses.ts`: exact header templates whose only
 * variable slots take measured values. An unseen wording is not parsed; it is
 * simply not an attack this engine resolves, so the enemy that carries it never
 * uses it. Measured over the 334 monsters in `data/srd-es/monsters.json`
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §4): 496 attacks
 * recognised, 39 not, and 316 monsters carry a profile.
 */

import { DAMAGE_TYPES, type DamageType } from "@/lib/rules/damage-modifiers";
import { ABILITIES, type Ability } from "@/lib/rules/ability-check";

export interface ProfiledDamage {
  /** "XdY±Z" (dice.ts notation) or a bare integer for flat damage. */
  dice: string;
  type: DamageType;
}

export interface ProfiledAttack {
  name: string;
  attackBonus: number;
  melee: { reachFt: number } | null;
  ranged: { normalFt: number; longFt: number | null } | null;
  damage: ProfiledDamage[];
}

export interface ProfiledAreaSaveAttack {
  name: string;
  /** Reduced from the SRD's cone/line/point shape to a maximum distance — the
   * grid has one possible target, so no real geometry is modelled (spec §1). */
  reachFt: number;
  saveAbility: Ability;
  saveDC: number;
  damage: ProfiledDamage[];
  /** 1d6; this roll or higher recharges the action (spec §2). */
  rechargeMin: 4 | 5 | 6;
}

export interface MultiattackPart {
  attack: string;
  count: number;
}

export interface MonsterAttackProfileV1 {
  version: 1;
  walkSpeedFt: number;
  attacks: ProfiledAttack[];
  multiattack: MultiattackPart[] | null;
  /** NULL for every monster without a recognised area-save action, and for
   * any profile persisted before this field existed (spec §4.4). */
  areaSaveAttack: ProfiledAreaSaveAttack | null;
}

type HeaderMode = "melee" | "ranged" | "both";

export const RECOGNISED_ATTACK_HEADERS: ReadonlyArray<{ mode: HeaderMode; template: string }> = [
  { mode: "melee", template: "Melee Weapon Attack: +{b} to hit, reach {r} ft., one target." },
  { mode: "melee", template: "Melee Weapon Attack: +{b} to hit, reach {r} ft., one creature." },
  { mode: "ranged", template: "Ranged Weapon Attack: +{b} to hit, range {rng} ft., one target." },
  {
    mode: "both",
    template: "Melee or Ranged Weapon Attack: +{b} to hit, reach {r} ft. or range {rng} ft., one target.",
  },
  { mode: "melee", template: "Melee Spell Attack: +{b} to hit, reach {r} ft., one creature." },
  { mode: "ranged", template: "Ranged Spell Attack: +{b} to hit, range {rng} ft., one target." },
  { mode: "ranged", template: "Ranged Weapon Attack: +{b} to hit, range {rng} ft., one creature." },
  {
    mode: "both",
    template: "Melee or Ranged Weapon Attack: +{b} to hit, reach {r} ft. or range {rng} ft., one creature.",
  },
];

/** Reach 0 is excluded: footprints never overlap on the grid (spec §4.2). */
export const RECOGNISED_REACH_FT: readonly number[] = [5, 10, 15, 20, 30, 50];

export const RECOGNISED_RANGES: ReadonlyMap<string, { normalFt: number; longFt: number | null }> =
  new Map([
    ["20/60", { normalFt: 20, longFt: 60 }],
    ["25/50", { normalFt: 25, longFt: 50 }],
    ["30/120", { normalFt: 30, longFt: 120 }],
    ["40/160", { normalFt: 40, longFt: 160 }],
    ["50/100", { normalFt: 50, longFt: 100 }],
    ["60/180", { normalFt: 60, longFt: 180 }],
    ["60/240", { normalFt: 60, longFt: 240 }],
    ["80/320", { normalFt: 80, longFt: 320 }],
    ["100/200", { normalFt: 100, longFt: 200 }],
    ["100/400", { normalFt: 100, longFt: 400 }],
    ["120", { normalFt: 120, longFt: null }],
    ["150", { normalFt: 150, longFt: null }],
    ["150/600", { normalFt: 150, longFt: 600 }],
  ]);

export const RECOGNISED_WALK_SPEEDS: ReadonlyMap<string, number> = new Map([
  ["0 ft.", 0],
  ["5 ft.", 5],
  ["10 ft.", 10],
  ["15 ft.", 15],
  ["20 ft.", 20],
  ["25 ft.", 25],
  ["30 ft.", 30],
  ["40 ft.", 40],
  ["50 ft.", 50],
  ["60 ft.", 60],
]);

/** dice.ts NOTATION_RE. */
const DICE_NOTATION = /^(\d+)?d(\d+)([+-]\d+)?$/i;
const FLAT_DAMAGE = /^\d+$/;

function slotPattern(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped
      .replace("\\{b\\}", "(?<b>\\d+)")
      .replace("\\{r\\}", "(?<r>\\d+)")
      .replace("\\{rng\\}", "(?<rng>\\d+(?:/\\d+)?)")}$`,
  );
}

const HEADERS = RECOGNISED_ATTACK_HEADERS.map((header) => ({
  mode: header.mode,
  pattern: slotPattern(header.template),
}));

const ABILITY_INDEX: Record<string, Ability> = {
  str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
};
const ABILITY_WORD_TO_INDEX: Record<string, string> = {
  strength: "str", dexterity: "dex", constitution: "con",
  intelligence: "int", wisdom: "wis", charisma: "cha",
};

/**
 * Verbatim, up to numeric and named slots (spec §4.2). Matching alone is not
 * enough: every slot is cross-checked against the action's own structured
 * dc/damage fields (decision 6) before any of it is trusted.
 */
// Built from a string, not a regex literal: named capturing groups in a
// literal require targeting ES2018+, and this project targets ES2017.
const AREA_SAVE_CLAUSE = new RegExp(
  "must (?:make|succeed on) a DC (?<dc>\\d+) " +
    "(?<ability>Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw, " +
    "taking \\d+ \\((?<dice>[^)]+)\\) (?<type>[a-z]+) damage on a failed save, " +
    "or half as much damage on a successful one\\.",
);

/**
 * The shape/size sentence has no structured counterpart, so it is the one
 * fact read from prose alone (spec §4.3). `a`/`an` is accepted either way —
 * the source data has at least one "an 60-foot line" typo.
 */
const AREA_SAVE_REACH: readonly RegExp[] = [
  /in an? (\d+)-foot cone\./,
  /in an? (\d+)-foot line that is \d+ (?:feet|ft\.) wide\./,
  /a (\d+)-foot cone of [a-z ]+\./,
  /spits [a-z ]+ in a line that is (\d+) ft\. long and \d+ ft\. wide/,
  /exhales a line of [a-z]+ that is (\d+) ft\. long and \d+ ft\. wide/,
  /within (\d+) feet of it\./,
];

function recogniseAreaSaveReach(desc: string): number | null {
  for (const pattern of AREA_SAVE_REACH) {
    const match = pattern.exec(desc);
    if (match) return Number(match[1]);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Average damage of a dice expression or a flat amount. @pure */
export function averageDamage(dice: string): number {
  if (FLAT_DAMAGE.test(dice)) return Number(dice);
  const match = DICE_NOTATION.exec(dice);
  if (!match) return 0;
  const count = match[1] ? Number(match[1]) : 1;
  const faces = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  return (count * (faces + 1)) / 2 + modifier;
}

function damageEntry(raw: unknown): ProfiledDamage | null {
  const entry = asRecord(raw);
  if (!entry) return null;

  if ("choose" in entry) {
    if (entry.choose !== 1) return null;
    const options = asRecord(entry.from)?.options;
    if (!Array.isArray(options) || options.length === 0) return null;
    const parsed = options.map(damageEntry);
    if (parsed.some((option) => option === null)) return null;
    // The lowest average never overstates damage; ties break by type name.
    return [...(parsed as ProfiledDamage[])].sort(
      (a, b) => averageDamage(a.dice) - averageDamage(b.dice) || a.type.localeCompare(b.type),
    )[0]!;
  }

  const dice = typeof entry.damage_dice === "string" ? entry.damage_dice.trim() : "";
  const type = asRecord(entry.damage_type)?.index;
  if (!(DICE_NOTATION.test(dice) || FLAT_DAMAGE.test(dice))) return null;
  if (typeof type !== "string" || !(DAMAGE_TYPES as readonly string[]).includes(type)) return null;
  return { dice, type: type as DamageType };
}

/** One SRD action as a resolvable attack, or null when it is not recognised. @pure */
export function recogniseAttack(action: unknown): ProfiledAttack | null {
  const a = asRecord(action);
  if (
    !a ||
    typeof a.name !== "string" ||
    typeof a.attack_bonus !== "number" ||
    typeof a.desc !== "string"
  ) {
    return null;
  }
  const header = a.desc.split(" Hit:")[0]!.trim();

  for (const { mode, pattern } of HEADERS) {
    const groups = pattern.exec(header)?.groups;
    if (!groups) continue;
    if (Number(groups.b) !== a.attack_bonus) return null;

    let melee: ProfiledAttack["melee"] = null;
    let ranged: ProfiledAttack["ranged"] = null;
    if (mode !== "ranged") {
      const reachFt = Number(groups.r);
      if (!RECOGNISED_REACH_FT.includes(reachFt)) return null;
      melee = { reachFt };
    }
    if (mode !== "melee") {
      const range = RECOGNISED_RANGES.get(groups.rng ?? "");
      if (!range) return null;
      ranged = { ...range };
    }

    if (!Array.isArray(a.damage) || a.damage.length === 0) return null;
    const damage = a.damage.map(damageEntry);
    if (damage.some((entry) => entry === null)) return null;

    return {
      name: a.name,
      attackBonus: a.attack_bonus,
      melee,
      ranged,
      damage: damage as ProfiledDamage[],
    };
  }
  return null;
}

/**
 * One SRD action as a resolvable area-save attack, or null when it is not
 * recognised (spec §4). An action with an `attack_bonus` belongs to
 * recogniseAttack, never to this one, even if it also carries a `dc` (the
 * aboleth's Tentacle rider).
 */
export function recogniseAreaSaveAttack(action: unknown): ProfiledAreaSaveAttack | null {
  const a = asRecord(action);
  if (!a || "attack_bonus" in a || typeof a.name !== "string" || typeof a.desc !== "string") {
    return null;
  }

  const dc = asRecord(a.dc);
  const ability = asRecord(dc?.dc_type)?.index;
  const dcValue = dc?.dc_value;
  if (typeof ability !== "string" || !(ability in ABILITY_INDEX) || typeof dcValue !== "number") {
    return null;
  }

  if (!Array.isArray(a.damage) || a.damage.length === 0) return null;
  const damage = a.damage.map(damageEntry);
  if (damage.some((entry) => entry === null)) return null;

  const usage = asRecord(a.usage);
  if (usage?.type !== "recharge on roll" || usage.dice !== "1d6") return null;
  const rechargeMin = usage.min_value;
  if (rechargeMin !== 4 && rechargeMin !== 5 && rechargeMin !== 6) return null;

  const clause = AREA_SAVE_CLAUSE.exec(a.desc)?.groups;
  if (!clause) return null;
  if (Number(clause.dc) !== dcValue) return null;
  if (ABILITY_WORD_TO_INDEX[clause.ability!.toLowerCase()] !== ability) return null;
  const first = (damage as ProfiledDamage[])[0]!;
  if (clause.dice !== first.dice || clause.type !== first.type) return null;

  const reachFt = recogniseAreaSaveReach(a.desc);
  if (reachFt === null) return null;

  return {
    name: a.name,
    reachFt,
    saveAbility: ABILITY_INDEX[ability]!,
    saveDC: dcValue,
    damage: damage as ProfiledDamage[],
    rechargeMin,
  };
}

function resolveMultiattack(
  actions: unknown[],
  attacks: ProfiledAttack[],
): MultiattackPart[] | null {
  const names = new Set(attacks.map((attack) => attack.name));
  for (const raw of actions) {
    const action = asRecord(raw);
    if (!action || typeof action.name !== "string") continue;
    if (!action.name.toLowerCase().startsWith("multiattack")) continue;
    if (action.action_options !== undefined) continue;
    if (!Array.isArray(action.actions) || action.actions.length === 0) continue;

    const parts: MultiattackPart[] = [];
    let resolvable = true;
    for (const rawPart of action.actions) {
      const part = asRecord(rawPart);
      const count = Number(part?.count);
      if (
        !part ||
        typeof part.action_name !== "string" ||
        !names.has(part.action_name) ||
        !Number.isInteger(count) ||
        count < 1
      ) {
        resolvable = false;
        break;
      }
      parts.push({ attack: part.action_name, count });
    }
    if (resolvable) return parts;
  }
  return null;
}

/** A monster's resolvable attacks, or null when it has none. @pure */
export function profileMonster(monster: unknown): MonsterAttackProfileV1 | null {
  const m = asRecord(monster);
  const actions = Array.isArray(m?.actions) ? (m!.actions as unknown[]) : [];
  const attacks = actions
    .map(recogniseAttack)
    .filter((attack): attack is ProfiledAttack => attack !== null);
  const areaSaveAttack =
    actions.map(recogniseAreaSaveAttack).find((a): a is ProfiledAreaSaveAttack => a !== null) ?? null;
  if (attacks.length === 0 && areaSaveAttack === null) return null;

  const walk = asRecord(m!.speed)?.walk;
  const walkSpeedFt = typeof walk === "string" ? (RECOGNISED_WALK_SPEEDS.get(walk) ?? 0) : 0;

  return {
    version: 1,
    walkSpeedFt,
    attacks,
    multiattack: resolveMultiattack(actions, attacks),
    areaSaveAttack,
  };
}

function isProfiledAttack(value: unknown): value is ProfiledAttack {
  const a = asRecord(value);
  if (!a || typeof a.name !== "string" || typeof a.attackBonus !== "number") return false;
  const melee = a.melee === null || typeof asRecord(a.melee)?.reachFt === "number";
  const ranged = a.ranged === null || typeof asRecord(a.ranged)?.normalFt === "number";
  const damage =
    Array.isArray(a.damage) &&
    a.damage.length > 0 &&
    a.damage.every((d) => {
      const entry = asRecord(d);
      return (
        typeof entry?.dice === "string" &&
        (DAMAGE_TYPES as readonly string[]).includes(entry.type as string)
      );
    });
  return melee && ranged && damage && (a.melee !== null || a.ranged !== null);
}

function isProfiledAreaSaveAttack(value: unknown): value is ProfiledAreaSaveAttack {
  const a = asRecord(value);
  if (!a || typeof a.name !== "string" || typeof a.reachFt !== "number") return false;
  if (typeof a.saveDC !== "number") return false;
  if (!(ABILITIES as readonly string[]).includes(a.saveAbility as string)) return false;
  if (a.rechargeMin !== 4 && a.rechargeMin !== 5 && a.rechargeMin !== 6) return false;
  return (
    Array.isArray(a.damage) &&
    a.damage.length > 0 &&
    a.damage.every((d) => {
      const entry = asRecord(d);
      return (
        typeof entry?.dice === "string" &&
        (DAMAGE_TYPES as readonly string[]).includes(entry.type as string)
      );
    })
  );
}

/**
 * Shape guard for the persisted JSON column. A profile that fails it is an
 * invariant failure, not a skipped turn (spec §8).
 */
export function isMonsterAttackProfile(value: unknown): value is MonsterAttackProfileV1 {
  const v = asRecord(value);
  if (!v || v.version !== 1 || typeof v.walkSpeedFt !== "number") return false;
  if (!Array.isArray(v.attacks) || !v.attacks.every(isProfiledAttack)) return false;

  // `!= null` on purpose: a profile persisted before this field existed omits
  // the key entirely (undefined), which must read exactly like an explicit
  // null — "no area attack" (spec §4.4).
  const hasAreaSaveAttack = v.areaSaveAttack != null;
  if (hasAreaSaveAttack && !isProfiledAreaSaveAttack(v.areaSaveAttack)) return false;
  if (v.attacks.length === 0 && !hasAreaSaveAttack) return false;

  if (v.multiattack === null) return true;
  return (
    Array.isArray(v.multiattack) &&
    v.multiattack.every((p) => {
      const part = asRecord(p);
      return typeof part?.attack === "string" && Number.isInteger(part.count);
    })
  );
}
