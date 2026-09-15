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

export interface MultiattackPart {
  attack: string;
  count: number;
}

export interface MonsterAttackProfileV1 {
  version: 1;
  walkSpeedFt: number;
  attacks: ProfiledAttack[];
  multiattack: MultiattackPart[] | null;
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
  if (attacks.length === 0) return null;

  const walk = asRecord(m!.speed)?.walk;
  const walkSpeedFt = typeof walk === "string" ? (RECOGNISED_WALK_SPEEDS.get(walk) ?? 0) : 0;

  return {
    version: 1,
    walkSpeedFt,
    attacks,
    multiattack: resolveMultiattack(actions, attacks),
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

/**
 * Shape guard for the persisted JSON column. A profile that fails it is an
 * invariant failure, not a skipped turn (spec §8).
 */
export function isMonsterAttackProfile(value: unknown): value is MonsterAttackProfileV1 {
  const v = asRecord(value);
  if (!v || v.version !== 1 || typeof v.walkSpeedFt !== "number") return false;
  if (!Array.isArray(v.attacks) || v.attacks.length === 0 || !v.attacks.every(isProfiledAttack)) {
    return false;
  }
  if (v.multiattack === null) return true;
  return (
    Array.isArray(v.multiattack) &&
    v.multiattack.every((p) => {
      const part = asRecord(p);
      return typeof part?.attack === "string" && Number.isInteger(part.count);
    })
  );
}
