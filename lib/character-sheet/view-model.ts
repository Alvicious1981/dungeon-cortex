/**
 * lib/character-sheet/view-model.ts
 *
 * Servidor de proyección pura para la hoja de personaje (VTT y exportación PDF).
 * Fase 8 (Character Sheet View-Model Overhaul & Unified Reader Service).
 *
 * Consume preferentemente las entidades relacionales canónicas normalizadas
 * (CharacterAbility, CharacterSkillProficiency, CharacterProficiency,
 * CharacterOrigin, CharacterSpellSlot, etc.) manteniendo compatibilidad total
 * y fallback transparente hacia los campos planos y blobs JSON legacy.
 */

import type { CharacterSheetProps, CharacterSpellSlot } from "@/components/character/CharacterSheetVTT";
import { abilityModifier } from "@/lib/rules/dice";
import { armorClassFor } from "@/lib/rules/armor-class";
import type { ItemType } from "@/lib/rules/inventory";
import {
  readWeaponProfile,
  weaponAttackBonus,
  type WeaponProfile,
} from "@/lib/rules/weapon-profile";
import { CLASS_SAVING_THROWS } from "@/lib/rules/canonical/character-proficiencies";
import { skillNameToCanonicalCode } from "@/lib/rules/canonical/character-skills";
import type { CharacterClass } from "@/lib/rules/proficiency";

export interface CharacterSheetSource {
  character: {
    id: string;
    name: string;
    race: string;
    class: string;
    level: number;
    hp: number;
    maxHp: number;
    xp: number;
    stats: unknown;
    spellSlots?: unknown;
    concentrationSpellId?: string | null;

    // Relaciones canónicas opcionales (con fallback elegante)
    abilities?: Array<{ abilityCode: string; baseScore: number }>;
    skills?: Array<{ skillCode: string; level: string }>;
    skillProficiencies?: unknown;
    languages?: Array<{ languageCode: string }>;
    proficiencies?: Array<{ type: string; code: string }>;
    classLevels?: Array<{
      classCode: string;
      subclassCode?: string | null;
      level: number;
      isPrimary: boolean;
    }>;
    origin?: {
      raceCode?: string;
      backgroundCode?: string | null;
      race?: { code?: string; name: string; speed?: number; size?: string } | null;
      background?: { code?: string; name: string } | null;
    } | null;
    features?: Array<{
      featureCode?: string;
      source?: string;
      feature?: { name: string; description?: string | null } | null;
    }>;
    feats?: Array<{
      featCode?: string;
      feat?: { name: string; description?: string | null } | null;
    }>;
    spellSlotRecords?: Array<{
      spellLevel: number;
      maxSlots: number;
      usedSlots: number;
    }>;
    spells?: Array<{
      spellSlug: string;
      isPrepared: boolean;
      isKnown: boolean;
      source: string;
    }>;
  };
  inventory: Array<{
    id: string;
    name: string;
    type: string;
    quantity: number;
    equippedSlot?: string | null;
    properties: unknown;
  }>;
  weaponProfiles?: ReadonlyMap<string, WeaponProfile>;
}

function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

function getStats(raw: unknown): Record<"STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA", number> {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    STR: typeof source.STR === "number" ? source.STR : 10,
    DEX: typeof source.DEX === "number" ? source.DEX : 10,
    CON: typeof source.CON === "number" ? source.CON : 10,
    INT: typeof source.INT === "number" ? source.INT : 10,
    WIS: typeof source.WIS === "number" ? source.WIS : 10,
    CHA: typeof source.CHA === "number" ? source.CHA : 10,
  };
}

function resolveEffectiveStats(
  character: CharacterSheetSource["character"]
): Record<"STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA", number> {
  if (character.abilities && character.abilities.length > 0) {
    const stats: Record<"STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA", number> = {
      STR: 10,
      DEX: 10,
      CON: 10,
      INT: 10,
      WIS: 10,
      CHA: 10,
    };
    for (const entry of character.abilities) {
      const item = entry as Record<string, unknown>;
      const rawCode = item.abilityCode ?? item.ability;
      if (!rawCode) continue;
      const code = String(rawCode).toUpperCase() as keyof typeof stats;
      const score =
        typeof item.baseScore === "number"
          ? item.baseScore
          : typeof item.score === "number"
            ? item.score
            : undefined;
      if (code in stats && typeof score === "number") {
        stats[code] = score;
      }
    }
    return stats;
  }
  return getStats(character.stats);
}

function buildSpellSlots(raw: unknown): CharacterSpellSlot[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  return Object.entries(raw as Record<string, unknown>).flatMap(([level, value]) => {
    if (!value || typeof value !== "object") return [];
    const slot = value as Record<string, unknown>;
    const total = typeof slot.total === "number" ? slot.total : slot.max;
    const used =
      typeof slot.used === "number"
        ? slot.used
        : typeof slot.current === "number" && typeof total === "number"
          ? Math.max(0, total - slot.current)
          : undefined;
    if (typeof total !== "number" || typeof used !== "number") return [];

    return [
      {
        level: Number(level),
        total,
        used,
      },
    ];
  });
}

function resolveSpellSlots(
  character: CharacterSheetSource["character"]
): CharacterSpellSlot[] {
  if (character.spellSlotRecords && character.spellSlotRecords.length > 0) {
    return character.spellSlotRecords
      .map((slot) => {
        const item = slot as Record<string, unknown>;
        const lvl =
          typeof item.spellLevel === "number"
            ? item.spellLevel
            : typeof item.slotLevel === "number"
              ? item.slotLevel
              : undefined;
        return {
          level: typeof lvl === "number" ? lvl : 1,
          total: slot.maxSlots,
          used: slot.usedSlots,
        };
      })
      .sort((a, b) => a.level - b.level);
  }
  return buildSpellSlots(character.spellSlots);
}

function resolveSpeedFeet(
  character: CharacterSheetSource["character"]
): number | null {
  if (
    character.origin?.race &&
    typeof character.origin.race.speed === "number" &&
    character.origin.race.speed > 0
  ) {
    return character.origin.race.speed;
  }
  return null;
}

const SAVING_THROW_DEFS: ReadonlyArray<{
  code: "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";
  label: string;
}> = [
  { code: "STR", label: "Fuerza" },
  { code: "DEX", label: "Destreza" },
  { code: "CON", label: "Constitución" },
  { code: "INT", label: "Inteligencia" },
  { code: "WIS", label: "Sabiduría" },
  { code: "CHA", label: "Carisma" },
];

const ALL_18_SKILLS: ReadonlyArray<{
  code: string;
  label: string;
  ability: "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";
}> = [
  { code: "acrobatics", label: "Acrobacias", ability: "DEX" },
  { code: "athletics", label: "Atletismo", ability: "STR" },
  { code: "arcana", label: "Conocimiento arcano", ability: "INT" },
  { code: "deception", label: "Engaño", ability: "CHA" },
  { code: "history", label: "Historia", ability: "INT" },
  { code: "intimidation", label: "Intimidación", ability: "CHA" },
  { code: "investigation", label: "Investigación", ability: "INT" },
  { code: "sleight-of-hand", label: "Juego de manos", ability: "DEX" },
  { code: "medicine", label: "Medicina", ability: "WIS" },
  { code: "nature", label: "Naturaleza", ability: "INT" },
  { code: "perception", label: "Percepción", ability: "WIS" },
  { code: "insight", label: "Perspicacia", ability: "WIS" },
  { code: "persuasion", label: "Persuasión", ability: "CHA" },
  { code: "religion", label: "Religión", ability: "INT" },
  { code: "stealth", label: "Sigilo", ability: "DEX" },
  { code: "survival", label: "Supervivencia", ability: "WIS" },
  { code: "animal-handling", label: "Trato con animales", ability: "WIS" },
  { code: "performance", label: "Interpretación", ability: "CHA" },
];

const LEGACY_6_SKILLS: ReadonlyArray<{
  code: string;
  label: string;
  ability: "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";
}> = [
  { code: "athletics", label: "Atletismo", ability: "STR" },
  { code: "acrobatics", label: "Acrobacias", ability: "DEX" },
  { code: "stealth", label: "Sigilo", ability: "DEX" },
  { code: "perception", label: "Percepción", ability: "WIS" },
  { code: "insight", label: "Perspicacia", ability: "WIS" },
  { code: "persuasion", label: "Persuasión", ability: "CHA" },
];

function getObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Display only stored properties. This does not infer effects or equipment costs. */
function itemDetails(raw: unknown): { summary?: string; tooltipLines: string[] } {
  const properties = getObject(raw);
  const description =
    typeof properties.description === "string"
      ? properties.description.trim()
      : Array.isArray(properties.description)
        ? properties.description
            .filter((part): part is string => typeof part === "string")
            .join("\n")
        : undefined;
  const lines: string[] = [];
  if (typeof properties.damageDice === "string") {
    const damageType =
      typeof properties.damageType === "string" ? ` ${properties.damageType}` : "";
    lines.push(`Daño base: ${properties.damageDice}${damageType}`);
  }
  const fields: Array<[string, string, string?]> = [
    ["damageBonus", "Bonificación de daño"],
    ["attackBonus", "Bonificación al ataque"],
    ["baseAC", "CA del objeto"],
    ["ac_bonus", "Bonificación de CA"],
    ["armorClass", "Tipo de armadura"],
    ["strengthRequirement", "Fuerza requerida"],
    ["maxDexBonus", "Bonificación máxima de Destreza"],
    ["weaponCategory", "Categoría de arma"],
    ["weaponRange", "Tipo de alcance"],
    ["rangeNormal", "Alcance normal", " pies"],
    ["rangeLong", "Alcance largo", " pies"],
    ["healingDice", "Dados de curación"],
    ["healingBonus", "Bonificación de curación"],
    ["charges", "Cargas"],
    ["spellLevel", "Nivel de conjuro"],
    ["castingTime", "Tiempo de lanzamiento"],
    ["range", "Alcance"],
    ["savingThrow", "Salvación"],
    ["duration", "Duración"],
    ["weightLbs", "Peso", " lb"],
    ["valueGP", "Valor", " po"],
  ];
  for (const [key, label, suffix = ""] of fields) {
    const value = properties[key];
    if (
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      lines.push(`${label}: ${value}${suffix}`);
    }
  }
  for (const [key, label] of [
    ["weaponProperties", "Propiedades"],
    ["effects", "Efectos"],
    ["components", "Componentes"],
  ]) {
    const value = properties[key];
    if (Array.isArray(value)) {
      const entries = value.filter(
        (entry): entry is string => typeof entry === "string"
      );
      if (entries.length) lines.push(`${label}: ${entries.join(", ")}`);
    }
  }
  if (typeof properties.addDexModifier === "boolean")
    lines.push(
      `Añade Destreza a la CA: ${properties.addDexModifier ? "sí" : "no"}`
    );
  if (typeof properties.stealthDisadvantage === "boolean")
    lines.push(
      `Sigilo: ${properties.stealthDisadvantage ? "desventaja" : "sin desventaja por este objeto"}`
    );
  for (const [key, label] of [
    ["magical", "Mágico"],
    ["silvered", "Plateado"],
    ["adamantine", "Adamantino"],
  ]) {
    if (typeof properties[key] === "boolean")
      lines.push(`${label}: ${properties[key] ? "sí" : "no"}`);
  }
  return { summary: description || undefined, tooltipLines: lines };
}

export function buildSheetViewModel({
  character,
  inventory,
  weaponProfiles,
}: CharacterSheetSource): CharacterSheetProps {
  const stats = resolveEffectiveStats(character);
  const proficiencyBonus = 2 + Math.floor((character.level - 1) / 4);
  const dexMod = abilityModifier(stats.DEX);
  const wisMod = abilityModifier(stats.WIS);
  const armorClass = armorClassFor({ inventory, dexModifier: dexMod }).armorClass;

  // 1. Competencias en tiradas de salvación
  const proficientSaveCodes = new Set<string>();
  if (character.proficiencies && character.proficiencies.length > 0) {
    for (const p of character.proficiencies) {
      const item = p as Record<string, unknown>;
      const pType = String(item.type ?? "").toUpperCase();
      const pCode = String(item.code ?? item.target ?? "").toUpperCase();
      if (pType === "SAVING_THROW" && pCode) {
        proficientSaveCodes.add(pCode);
      }
    }
  } else if (character.class) {
    const normClass = character.class.trim().toLowerCase() as CharacterClass;
    const defaultSaves = CLASS_SAVING_THROWS[normClass];
    if (defaultSaves) {
      for (const s of defaultSaves) {
        proficientSaveCodes.add(s.toUpperCase());
      }
    }
  }

  // 2. Competencias en habilidades (mapa de niveles: "PROFICIENT" | "EXPERTISE")
  const skillProficiencyMap = new Map<string, string>();
  if (character.skills && character.skills.length > 0) {
    for (const s of character.skills) {
      const item = s as Record<string, unknown>;
      const sCode = String(item.skillCode ?? item.skill ?? "").toLowerCase();
      const sLevel = String(
        item.level ??
          (item.expertise
            ? "EXPERTISE"
            : item.proficient
              ? "PROFICIENT"
              : "")
      ).toUpperCase();
      if (sCode && sLevel) {
        skillProficiencyMap.set(sCode, sLevel);
      }
    }
  } else if (
    Array.isArray(character.skillProficiencies) &&
    character.skillProficiencies.length > 0
  ) {
    for (const name of character.skillProficiencies) {
      if (typeof name === "string") {
        const code = skillNameToCanonicalCode(name);
        if (code) {
          skillProficiencyMap.set(code.toLowerCase(), "PROFICIENT");
        }
      }
    }
  }

  // 3. Proyección de habilidades
  const use18Skills =
    (character.skills && character.skills.length > 0) ||
    (Array.isArray(character.skillProficiencies) &&
      character.skillProficiencies.length > 0);

  const skillsList = use18Skills ? ALL_18_SKILLS : LEGACY_6_SKILLS;

  const skills = skillsList.map((skillDef) => {
    const profLevel = skillProficiencyMap.get(skillDef.code.toLowerCase());
    const isExpert = profLevel === "EXPERTISE";
    const isProficient = isExpert || profLevel === "PROFICIENT";
    const bonusMultiplier = isExpert ? 2 : isProficient ? 1 : 0;
    const baseMod = abilityModifier(stats[skillDef.ability]);
    const totalBonus = baseMod + bonusMultiplier * proficiencyBonus;

    return {
      label: skillDef.label,
      value: formatModifier(totalBonus),
      proficient: isProficient,
    };
  });

  // 4. Percepción pasiva conforme a regla RAW 5e
  const perceptionLevel = skillProficiencyMap.get("perception");
  const perceptionBonusMult =
    perceptionLevel === "EXPERTISE" ? 2 : perceptionLevel === "PROFICIENT" ? 1 : 0;
  const passivePerception = 10 + wisMod + perceptionBonusMult * proficiencyBonus;

  // 5. Salvaciones
  const savingThrows = SAVING_THROW_DEFS.map((def) => {
    const isProficient = proficientSaveCodes.has(def.code);
    const baseMod = abilityModifier(stats[def.code]);
    const totalMod = baseMod + (isProficient ? proficiencyBonus : 0);

    return {
      label: def.label,
      value: formatModifier(totalMod),
      proficient: isProficient,
    };
  });

  // 6. Notas consolidadas (idiomas, rasgos y dotes canónicas si existen)
  const notes: string[] = [];
  if (character.languages && character.languages.length > 0) {
    const langs = character.languages.map((l) => l.languageCode).join(", ");
    notes.push(`Idiomas: ${langs}`);
  }
  if (character.features && character.features.length > 0) {
    for (const f of character.features) {
      const name = f.feature?.name ?? f.featureCode;
      notes.push(`Rasgo: ${name}`);
    }
  }
  if (character.feats && character.feats.length > 0) {
    for (const f of character.feats) {
      const name = f.feat?.name ?? f.featCode;
      notes.push(`Dote: ${name}`);
    }
  }

  return {
    identity: {
      name: character.name,
      className: character.class,
      level: character.level,
      race: character.origin?.race?.name ?? character.race,
      background: character.origin?.background?.name ?? undefined,
    },
    core: {
      armorClass,
      hitPoints: { current: character.hp, max: character.maxHp },
      initiative: dexMod,
      speedFeet: resolveSpeedFeet(character),
      proficiencyBonus,
      passivePerception,
    },
    abilities: {
      str: {
        score: stats.STR,
        modifier: abilityModifier(stats.STR),
        proficient: proficientSaveCodes.has("STR"),
      },
      dex: {
        score: stats.DEX,
        modifier: dexMod,
        proficient: proficientSaveCodes.has("DEX"),
      },
      con: {
        score: stats.CON,
        modifier: abilityModifier(stats.CON),
        proficient: proficientSaveCodes.has("CON"),
      },
      int: {
        score: stats.INT,
        modifier: abilityModifier(stats.INT),
        proficient: proficientSaveCodes.has("INT"),
      },
      wis: {
        score: stats.WIS,
        modifier: wisMod,
        proficient: proficientSaveCodes.has("WIS"),
      },
      cha: {
        score: stats.CHA,
        modifier: abilityModifier(stats.CHA),
        proficient: proficientSaveCodes.has("CHA"),
      },
    },
    savingThrows,
    skills,
    attacks: inventory
      .filter((item) => item.type === "weapon")
      .map((weapon) => {
        const properties = getObject(weapon.properties);
        const profile =
          weaponProfiles?.get(weapon.id) ?? readWeaponProfile(properties);
        const attack = weaponAttackBonus({
          profile,
          stats,
          characterClass: character.class,
          level: character.level,
        });

        const abilityMod = abilityModifier(stats[attack.abilityUsed]);
        const damageBonus =
          abilityMod +
          (typeof properties.damageBonus === "number"
            ? properties.damageBonus
            : 0);
        const damageDice = profile.damageDice ?? "N/D";
        const damageType = profile.damageType ?? "";

        return {
          id: weapon.id,
          name: weapon.name,
          bonus: attack.bonus,
          damage: `${damageDice}${damageBonus === 0 ? "" : formatModifier(damageBonus)} ${damageType}`.trim(),
          traits: [...profile.traits],
        };
      }),
    spellSlots: resolveSpellSlots(character),
    inventory: inventory.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      category: item.type as ItemType,
      equipped: item.equippedSlot !== null && item.equippedSlot !== undefined,
      equippedSlot: item.equippedSlot ?? null,
      ...itemDetails(item.properties),
    })),
    notes,
  };
}
