/**
 * scripts/ingest-srd.ts
 *
 * Parses D&D 5.1 SRD (2014) Markdown files from docs/reference/srd/ and upserts
 * them into the SrdMonster and SrdSpell Prisma tables.
 *
 * MUST NOT be used with 5.2/2024 content — maintains strict backwards compatibility.
 * Run: npx tsx scripts/ingest-srd.ts
 */

import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const SRD_DIR = path.join(__dirname, '../docs/reference/srd');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a display name to a URL-safe slug, e.g. "Adult Red Dragon" → "adult-red-dragon" */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Parse CR strings like "1/4", "1/2", "1/8", "17" to float. Returns null on failure. */
function parseCr(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length === 2) {
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      if (!isNaN(num) && !isNaN(den) && den !== 0) return num / den;
    }
    return null;
  }
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

/** Parse "7 (2d6)" → { hp: 7, hitDice: "2d6" } */
function parseHp(raw: string): { hp: number | null; hitDice: string | null } {
  const match = raw.match(/^(\d+)\s*(\(([^)]+)\))?/);
  if (!match) return { hp: null, hitDice: null };
  return {
    hp: parseInt(match[1], 10),
    hitDice: match[3] ?? null,
  };
}

/** Parse "15 (leather armor, shield)" → 15 */
function parseAc(raw: string): number | null {
  const match = raw.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Parse "| 8 (-1)   | 14 (+2) | ..." → [8, 14, 10, 10, 8, 8] */
function parseAbilityScoreRow(row: string): number[] | null {
  const cells = row.split('|').map(c => c.trim()).filter(Boolean);
  if (cells.length < 6) return null;
  const scores = cells.slice(0, 6).map(c => {
    const m = c.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : NaN;
  });
  if (scores.some(isNaN)) return null;
  return scores;
}

/** Returns a lower-case array from a comma-separated damage/condition list. */
function parseList(raw: string): string[] {
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ─── Monster Parser ────────────────────────────────────────────────────────────

interface ParsedMonster {
  name: string;
  indexSlug: string;
  size: string | null;
  type: string | null;
  subtype: string | null;
  alignment: string | null;
  armorClass: number | null;
  hitPoints: number | null;
  hitDice: string | null;
  speed: string | null;
  strength: number | null;
  dexterity: number | null;
  constitution: number | null;
  intelligence: number | null;
  wisdom: number | null;
  charisma: number | null;
  cr: number | null;
  xp: number | null;
  proficiencyBonus: number | null;
  languages: string | null;
  hasLegendaryActions: boolean;
  hasSpellcasting: boolean;
  damageImmunities: string[];
  damageResistances: string[];
  damageVulnerabilities: string[];
  conditionImmunities: string[];
  data: object;
}

/** CR → proficiency bonus table (5e 2014 SRD) */
function crToProfBonus(cr: number | null): number | null {
  if (cr === null) return null;
  if (cr <= 4) return 2;
  if (cr <= 8) return 3;
  if (cr <= 12) return 4;
  if (cr <= 16) return 5;
  if (cr <= 20) return 6;
  if (cr <= 24) return 7;
  if (cr <= 28) return 8;
  return 9;
}

function parseMonster(content: string): ParsedMonster | null {
  const lines = content.split(/\r?\n/);

  // Extract name from first heading line (## Name or # Name or ### Name)
  const headingLine = lines.find(l => /^#{1,3}\s/.test(l));
  if (!headingLine) return null;
  const name = headingLine.replace(/^#{1,3}\s+/, '').trim();

  // Skip non-statblock files (like "# Monster Statistics" reference or "Customizing NPCs")
  // A valid monster file MUST contain "Armor Class" and "Hit Points"
  if (!content.includes('**Armor Class**') || !content.includes('**Hit Points**')) {
    return null;
  }

  const indexSlug = toSlug(name);

  // ── Type line: *Size type (subtype), alignment*
  const typeLine = lines.find(l => /^\*[A-Z]/.test(l.trim()));
  let size: string | null = null;
  let type: string | null = null;
  let subtype: string | null = null;
  let alignment: string | null = null;

  if (typeLine) {
    const inner = typeLine.trim().replace(/^\*/, '').replace(/\*$/, '').trim();
    // e.g. "Large aberration, lawful evil"  or "Large dragon (chromatic), chaotic evil"
    const sizeTypes = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
    for (const s of sizeTypes) {
      if (inner.startsWith(s)) {
        size = s;
        const rest = inner.slice(s.length).trim(); // "aberration, lawful evil"
        // Split on comma to get type block and alignment
        const commaIdx = rest.search(/,\s*[a-z]/);
        if (commaIdx !== -1) {
          const typeBlock = rest.slice(0, commaIdx).trim(); // "aberration (goblinoid)"
          alignment = rest.slice(commaIdx + 1).trim(); // "lawful evil"
          const subtypeMatch = typeBlock.match(/^(\S+)\s+\(([^)]+)\)$/);
          if (subtypeMatch) {
            type = subtypeMatch[1].toLowerCase();
            subtype = subtypeMatch[2].toLowerCase();
          } else {
            type = typeBlock.toLowerCase();
          }
        } else {
          // No alignment comma — take whole rest as type
          type = rest.toLowerCase();
        }
        break;
      }
    }
  }

  // ── AC
  const acLine = lines.find(l => l.startsWith('**Armor Class**'));
  const armorClass = acLine ? parseAc(acLine.replace('**Armor Class**', '').trim()) : null;

  // ── HP
  const hpLine = lines.find(l => l.startsWith('**Hit Points**'));
  const { hp: hitPoints, hitDice } = hpLine
    ? parseHp(hpLine.replace('**Hit Points**', '').trim())
    : { hp: null, hitDice: null };

  // ── Speed
  const speedLine = lines.find(l => l.startsWith('**Speed**'));
  const speed = speedLine ? speedLine.replace('**Speed**', '').trim() : null;

  // ── Ability scores — find the data row below the | STR | DEX | ... header
  let strength: number | null = null;
  let dexterity: number | null = null;
  let constitution: number | null = null;
  let intelligence: number | null = null;
  let wisdom: number | null = null;
  let charisma: number | null = null;

  const headerIdx = lines.findIndex(l => /STR.*DEX.*CON.*INT.*WIS.*CHA/.test(l));
  if (headerIdx !== -1) {
    // Data row is 2 lines below header (skip separator row)
    for (let i = headerIdx + 1; i <= Math.min(headerIdx + 3, lines.length - 1); i++) {
      const row = lines[i];
      if (!/^\|/.test(row)) continue;
      // Skip separator lines like |:---:|:---:|
      if (/^[|\s:-]+$/.test(row.replace(/[|:\-\s]/g, ''))) continue;
      const scores = parseAbilityScoreRow(row);
      if (scores) {
        [strength, dexterity, constitution, intelligence, wisdom, charisma] = scores;
        break;
      }
    }
  }

  // ── Challenge Rating and XP
  const crLine = lines.find(l => l.startsWith('**Challenge**'));
  let cr: number | null = null;
  let xp: number | null = null;
  if (crLine) {
    // "**Challenge** 17 (18,000 XP)" or "**Challenge** 1/4 (50 XP)"
    const crMatch = crLine.match(/\*\*Challenge\*\*\s+([\d/]+)\s+\(([0-9,]+)\s+XP\)/i);
    if (crMatch) {
      cr = parseCr(crMatch[1]);
      xp = parseInt(crMatch[2].replace(/,/g, ''), 10);
    }
  }

  const proficiencyBonus = crToProfBonus(cr);

  // ── Languages
  const langLine = lines.find(l => l.startsWith('**Languages**'));
  const languages = langLine ? langLine.replace('**Languages**', '').trim() : null;

  // ── Damage immunities / resistances / vulnerabilities / condition immunities
  const diLine = lines.find(l => l.startsWith('**Damage Immunities**'));
  const drLine = lines.find(l => l.startsWith('**Damage Resistances**'));
  const dvLine = lines.find(l => l.startsWith('**Damage Vulnerabilities**'));
  const ciLine = lines.find(l => l.startsWith('**Condition Immunities**'));

  const damageImmunities = diLine ? parseList(diLine.replace('**Damage Immunities**', '')) : [];
  const damageResistances = drLine ? parseList(drLine.replace('**Damage Resistances**', '')) : [];
  const damageVulnerabilities = dvLine ? parseList(dvLine.replace('**Damage Vulnerabilities**', '')) : [];
  const conditionImmunities = ciLine ? parseList(ciLine.replace('**Condition Immunities**', '')) : [];

  // ── Flags
  const hasLegendaryActions = /#+\s+Legendary Actions/i.test(content);
  const hasSpellcasting = /Spellcasting|Innate Spellcasting/i.test(content);

  const data = {
    source: 'SRD 5.1',
    raw: content,
  };

  return {
    name,
    indexSlug,
    size,
    type,
    subtype,
    alignment,
    armorClass,
    hitPoints,
    hitDice,
    speed,
    strength,
    dexterity,
    constitution,
    intelligence,
    wisdom,
    charisma,
    cr,
    xp,
    proficiencyBonus,
    languages,
    hasLegendaryActions,
    hasSpellcasting,
    damageImmunities,
    damageResistances,
    damageVulnerabilities,
    conditionImmunities,
    data,
  };
}

// ─── Spell Parser ──────────────────────────────────────────────────────────────

interface ParsedSpell {
  name: string;
  indexSlug: string;
  level: number;
  school: string | null;
  ritual: boolean;
  concentration: boolean;
  castingTime: string | null;
  range: string | null;
  duration: string | null;
  components: string[];
  classes: string[];
  attackType: string | null;
  damageType: string | null;
  saveAbility: string | null;
  hasHealing: boolean;
  hasAreaOfEffect: boolean;
  data: object;
}

/** Parse level line like "*3rd-level evocation*", "*Conjuration cantrip*", "*1st-level divination (ritual)*" */
function parseLevelLine(raw: string): { level: number; school: string | null; ritual: boolean } {
  const inner = raw.replace(/^\*/, '').replace(/\*$/, '').trim().toLowerCase();
  const ritual = inner.includes('ritual');

  // Cantrip
  if (inner.includes('cantrip')) {
    const school = inner.replace('cantrip', '').replace('(ritual)', '').replace(/\(.*?\)/g, '').trim() || null;
    return { level: 0, school, ritual };
  }

  // e.g. "3rd-level evocation" or "1st-level divination (ritual)"
  const levelMatch = inner.match(/(\d+)(?:st|nd|rd|th)-level\s+(\w+)/);
  if (levelMatch) {
    return {
      level: parseInt(levelMatch[1], 10),
      school: levelMatch[2] ?? null,
      ritual,
    };
  }

  return { level: 0, school: null, ritual };
}

/** Parse components string like "V, S, M (a tiny ball of bat guano)" → ["V", "S", "M"] */
function parseComponents(raw: string): string[] {
  return raw
    .replace(/\([^)]*\)/g, '') // strip material description
    .split(',')
    .map(c => c.trim())
    .filter(Boolean);
}

/** Infer attack type from spell description */
function inferAttackType(content: string): string | null {
  if (/ranged spell attack/i.test(content)) return 'ranged';
  if (/melee spell attack/i.test(content)) return 'melee';
  return null;
}

/** Infer damage type from common keywords */
function inferDamageType(content: string): string | null {
  const types = [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
    'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
  ];
  for (const t of types) {
    const re = new RegExp(`\\b${t}\\s+damage`, 'i');
    if (re.test(content)) return t;
  }
  return null;
}

/** Infer saving throw ability */
function inferSaveAbility(content: string): string | null {
  const abilities: Record<string, string> = {
    strength: 'STR', dexterity: 'DEX', constitution: 'CON',
    intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA',
  };
  const match = content.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i);
  if (match) return abilities[match[1].toLowerCase()] ?? null;
  return null;
}

function parseSpell(content: string): ParsedSpell | null {
  const lines = content.split(/\r?\n/);

  // Name
  const headingLine = lines.find(l => /^#{1,3}\s/.test(l));
  if (!headingLine) return null;
  const name = headingLine.replace(/^#{1,3}\s+/, '').trim();

  // Must have a casting time to be a real spell (filters out Spell Lists meta files)
  if (!/\*\*Casting Time:\*\*/i.test(content)) return null;

  const indexSlug = toSlug(name);

  // Level line — find the italic line below the heading (starts with *)
  const levelLine = lines.find(l => /^\*[^*]/.test(l.trim()) && !l.trim().startsWith('***'));
  const { level, school, ritual } = levelLine
    ? parseLevelLine(levelLine.trim())
    : { level: 0, school: null, ritual: false };

  // Concentration
  const concentration = /\*\*Duration:\*\*\s*Concentration/i.test(content);

  // Fields
  const ctLine = lines.find(l => /\*\*Casting Time:\*\*/i.test(l));
  const castingTime = ctLine ? ctLine.replace(/\*\*Casting Time:\*\*/i, '').trim() : null;

  const rangeLine = lines.find(l => /\*\*Range:\*\*/i.test(l));
  const range = rangeLine ? rangeLine.replace(/\*\*Range:\*\*/i, '').trim() : null;

  const durLine = lines.find(l => /\*\*Duration:\*\*/i.test(l));
  const duration = durLine ? durLine.replace(/\*\*Duration:\*\*/i, '').trim() : null;

  const compLine = lines.find(l => /\*\*Components:\*\*/i.test(l));
  const components = compLine ? parseComponents(compLine.replace(/\*\*Components:\*\*/i, '').trim()) : [];

  // Inferred fields
  const attackType = inferAttackType(content);
  const damageType = inferDamageType(content);
  const saveAbility = inferSaveAbility(content);
  const hasHealing = /\bheal(s|ing)?\b|\bregain\b.*\bhit points?\b/i.test(content);
  const hasAreaOfEffect = /\b(\d+-foot (cone|cube|cylinder|line|radius|sphere|square))\b/i.test(content);

  const data = {
    source: 'SRD 5.1',
    raw: content,
  };

  return {
    name,
    indexSlug,
    level,
    school,
    ritual,
    concentration,
    castingTime,
    range,
    duration,
    components,
    classes: [], // SRD markdown files don't embed class lists
    attackType,
    damageType,
    saveAbility,
    hasHealing,
    hasAreaOfEffect,
    data,
  };
}

// ─── Ingest Functions ──────────────────────────────────────────────────────────

async function ingestMonsters(): Promise<number> {
  const monstersDir = path.join(SRD_DIR, 'Monsters');
  if (!fs.existsSync(monstersDir)) {
    console.warn('  Monsters directory not found, skipping.');
    return 0;
  }

  const files = fs.readdirSync(monstersDir).filter(f => f.endsWith('.md'));
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(monstersDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    const parsed = parseMonster(content);
    if (!parsed) {
      console.log(`  [SKIP]    ${file} — no valid stat block`);
      skipped++;
      continue;
    }

    const id = `srd-monster-${parsed.indexSlug}`;

    try {
      const payload = {
        name: parsed.name,
        indexSlug: parsed.indexSlug,
        cr: parsed.cr,
        type: parsed.type,
        subtype: parsed.subtype,
        size: parsed.size,
        alignment: parsed.alignment,
        xp: parsed.xp,
        proficiencyBonus: parsed.proficiencyBonus,
        hitPoints: parsed.hitPoints,
        hitDice: parsed.hitDice,
        armorClass: parsed.armorClass,
        speed: parsed.speed,
        languages: parsed.languages,
        strength: parsed.strength,
        dexterity: parsed.dexterity,
        constitution: parsed.constitution,
        intelligence: parsed.intelligence,
        wisdom: parsed.wisdom,
        charisma: parsed.charisma,
        hasLegendaryActions: parsed.hasLegendaryActions,
        hasSpellcasting: parsed.hasSpellcasting,
        damageImmunities: parsed.damageImmunities,
        damageResistances: parsed.damageResistances,
        damageVulnerabilities: parsed.damageVulnerabilities,
        conditionImmunities: parsed.conditionImmunities,
        data: parsed.data,
      };
      await prisma.srdMonster.upsert({
        where: { id },
        update: payload,
        create: { id, ...payload },
      });
      console.log(`  [OK]      ${parsed.name} (CR ${parsed.cr ?? '?'}, ${parsed.type ?? '?'})`);
      inserted++;
    } catch (err) {
      console.error(`  [ERROR]   ${file}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n  Monsters: ${inserted} upserted, ${skipped} skipped, ${errors} errors.`);
  return inserted;
}

async function ingestSpells(): Promise<number> {
  const spellsDir = path.join(SRD_DIR, 'Spells');
  if (!fs.existsSync(spellsDir)) {
    console.warn('  Spells directory not found, skipping.');
    return 0;
  }

  const files = fs.readdirSync(spellsDir).filter(f => f.endsWith('.md'));
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(spellsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    const parsed = parseSpell(content);
    if (!parsed) {
      console.log(`  [SKIP]    ${file} — no valid spell block`);
      skipped++;
      continue;
    }

    const id = `srd-spell-${parsed.indexSlug}`;

    try {
      const payload = {
        name: parsed.name,
        indexSlug: parsed.indexSlug,
        level: parsed.level,
        school: parsed.school,
        ritual: parsed.ritual,
        concentration: parsed.concentration,
        castingTime: parsed.castingTime,
        range: parsed.range,
        duration: parsed.duration,
        components: parsed.components,
        classes: parsed.classes,
        attackType: parsed.attackType,
        damageType: parsed.damageType,
        saveAbility: parsed.saveAbility,
        hasHealing: parsed.hasHealing,
        hasAreaOfEffect: parsed.hasAreaOfEffect,
        data: parsed.data,
      };
      await prisma.srdSpell.upsert({
        where: { id },
        update: payload,
        create: { id, ...payload },
      });
      console.log(`  [OK]      ${parsed.name} (Level ${parsed.level}, ${parsed.school ?? '?'})`);
      inserted++;
    } catch (err) {
      console.error(`  [ERROR]   ${file}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n  Spells: ${inserted} upserted, ${skipped} skipped, ${errors} errors.`);
  return inserted;
}

async function ingestEquipment(): Promise<number> {
  const equipFile = path.join(__dirname, '../data/srd-es/equipment.json');
  if (!fs.existsSync(equipFile)) {
    console.warn('  Equipment JSON not found, skipping.');
    return 0;
  }

  const content = fs.readFileSync(equipFile, 'utf-8');
  let equipmentList: any[];
  try {
    equipmentList = JSON.parse(content);
  } catch (err) {
    console.error('  [ERROR] Failed to parse equipment.json:', err);
    return 0;
  }

  let inserted = 0;
  let errors = 0;

  for (const item of equipmentList) {
    if (!item.index || !item.name) continue;
    const id = `srd-equipment-${item.index}`;

    // Flatten properties array to string array
    const properties = Array.isArray(item.properties)
      ? item.properties.map((p: any) => p.name || p.index || String(p))
      : [];

    let desc = null;
    if (item.desc) {
      desc = Array.isArray(item.desc) ? item.desc.join('\n') : String(item.desc);
    }

    try {
      const payload = {
        name: item.name,
        indexSlug: item.index,
        equipmentCategory: item.equipment_category?.name || item.equipment_category?.index || null,
        weaponCategory: item.weapon_category || null,
        weaponRange: item.weapon_range || null,
        categoryRange: item.category_range || null,
        costQuantity: item.cost?.quantity ?? null,
        costUnit: item.cost?.unit ?? null,
        weight: item.weight ?? null,
        damageDice: item.damage?.damage_dice || null,
        damageType: item.damage?.damage_type?.name || item.damage?.damage_type?.index || null,
        twoHandedDamageDice: item.two_handed_damage?.damage_dice || null,
        twoHandedDamageType: item.two_handed_damage?.damage_type?.name || item.two_handed_damage?.damage_type?.index || null,
        rangeNormal: item.range?.normal ?? null,
        rangeLong: item.range?.long ?? null,
        armorCategory: item.armor_category || null,
        armorClassBase: item.armor_class?.base ?? null,
        armorClassDexBonus: item.armor_class?.dex_bonus ?? null,
        armorClassMaxBonus: item.armor_class?.max_bonus ?? null,
        strMinimum: item.str_minimum ?? null,
        stealthDisadvantage: item.stealth_disadvantage ?? null,
        desc,
        properties,
        data: item,
      };

      await prisma.srdEquipment.upsert({
        where: { id },
        update: payload,
        create: { id, ...payload },
      });
      console.log(`  [OK]      ${item.name} (${payload.equipmentCategory ?? '?'})`);
      inserted++;
    } catch (err) {
      console.error(`  [ERROR]   ${item.index}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n  Equipment: ${inserted} upserted, ${errors} errors.`);
  return inserted;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        SRD 5.1 Ingestion — Dungeon Cortex (Code is Law)     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('Starting SRD 5.1 Ingestion process...\n');

  try {
    console.log('► Ingesting Monsters...');
    const monsterCount = await ingestMonsters();

    console.log('\n► Ingesting Spells...');
    const spellCount = await ingestSpells();

    console.log('\n► Ingesting Equipment...');
    const equipCount = await ingestEquipment();

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    INGESTION COMPLETE                       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  SrdMonster rows upserted: ${String(monsterCount).padEnd(33)}║`);
    console.log(`║  SrdSpell rows upserted:   ${String(spellCount).padEnd(33)}║`);
    console.log(`║  Total:                    ${String(monsterCount + spellCount).padEnd(33)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
  } catch (error) {
    console.error('\n[FATAL] Failed to ingest SRD 5.1 data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
