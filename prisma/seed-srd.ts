import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const db = prisma as any;

const CHUNK_SIZE = 100;

type JsonRecord = Record<string, unknown>;

type SeedStats = {
  entity: string;
  total: number;
  upserted: number;
  skipped: number;
  failed: number;
  failures: Array<{ id: string; reason: string }>;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function pickFirst(obj: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key];
    }
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return null;
}

function asFloat(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "s"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return null;
}

function refIndex(value: unknown): string | null {
  const rec = asRecord(value);
  const idx = asString(rec.index);
  if (idx) return idx;
  const name = asString(rec.name);
  if (name) return name.toLowerCase().replace(/\s+/g, "-");
  return null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        const rec = asRecord(entry);
        return asString(rec.index) ?? asString(rec.name) ?? "";
      })
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

function parseArmorClass(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = asRecord(value[0]);
    const ac = asInt(first.value);
    return ac;
  }
  return null;
}

function hasSpellcastingAbilities(monster: JsonRecord): boolean {
  const special = pickFirst(monster, ["special_abilities", "habilidades_especiales"]);
  const list = Array.isArray(special) ? special : [];
  for (const entry of list) {
    const rec = asRecord(entry);
    const name = (asString(rec.name) ?? "").toLowerCase();
    const desc = (asString(rec.desc) ?? "").toLowerCase();
    if (name.includes("spellcasting") || name.includes("lanzamiento de conjuros")) return true;
    if (desc.includes("spellcasting") || desc.includes("lanzamiento de conjuros")) return true;
    if (desc.includes("innate spellcasting") || desc.includes("conjuro innato")) return true;
  }
  return false;
}

function normalizeMonster(raw: unknown): { id: string; name: string; payload: JsonRecord } | null {
  const m = asRecord(raw);
  const id = asString(pickFirst(m, ["id", "slug", "index", "name"]));
  const name = asString(m.name);
  if (!id || !name) return null;

  const speedRaw = pickFirst(m, ["speed", "velocidad"]);
  const speed = typeof speedRaw === "string" ? speedRaw : JSON.stringify(speedRaw ?? null);

  const payload: JsonRecord = {
    name,
    indexSlug: asString(pickFirst(m, ["index", "slug"])),
    cr: asFloat(pickFirst(m, ["challenge_rating", "cr"])),
    type: asString(m.type),
    subtype: asString(m.subtype),
    size: asString(m.size),
    alignment: asString(m.alignment),
    xp: asInt(m.xp),
    proficiencyBonus: asInt(pickFirst(m, ["proficiency_bonus", "proficiencyBonus"])),
    hitPoints: asInt(pickFirst(m, ["hit_points", "hitPoints"])),
    hitDice: asString(pickFirst(m, ["hit_dice", "hitDice"])),
    armorClass: parseArmorClass(pickFirst(m, ["armor_class", "armorClass"])),
    speed,
    languages: asString(m.languages),
    strength: asInt(m.strength),
    dexterity: asInt(m.dexterity),
    constitution: asInt(m.constitution),
    intelligence: asInt(m.intelligence),
    wisdom: asInt(m.wisdom),
    charisma: asInt(m.charisma),
    hasLegendaryActions: Array.isArray(m.legendary_actions)
      ? m.legendary_actions.length > 0
      : null,
    hasSpellcasting: hasSpellcastingAbilities(m),
    damageImmunities: toStringArray(m.damage_immunities),
    damageResistances: toStringArray(m.damage_resistances),
    damageVulnerabilities: toStringArray(m.damage_vulnerabilities),
    conditionImmunities: toStringArray(m.condition_immunities),
    data: m,
  };

  return { id, name, payload };
}

function normalizeSpell(raw: unknown): { id: string; name: string; payload: JsonRecord } | null {
  const s = asRecord(raw);
  const id = asString(pickFirst(s, ["id", "slug", "index", "name"]));
  const name = asString(s.name);
  if (!id || !name) return null;

  const schoolRaw = pickFirst(s, ["school", "escuela"]);
  const damageRaw = asRecord(s.damage);
  const dcRaw = asRecord(s.dc);

  const classesRaw = pickFirst(s, ["classes", "clases"]);
  const componentsRaw = pickFirst(s, ["components", "componentes"]);

  const hasHealing =
    pickFirst(s, ["heal_at_slot_level"]) !== undefined ||
    asString(s.desc)?.toLowerCase().includes("heal") === true ||
    asString(s.desc)?.toLowerCase().includes("cura") === true;

  const hasAreaOfEffect =
    pickFirst(s, ["area_of_effect", "area_de_efecto", "area_of_effect"]) !== undefined;

  const payload: JsonRecord = {
    name,
    indexSlug: asString(pickFirst(s, ["index", "slug"])),
    level: asInt(pickFirst(s, ["level", "nivel"])),
    school: refIndex(schoolRaw),
    castingTime: asString(
      pickFirst(s, ["casting_time", "tiempo_de_lanzamiento", "tiempo_lanzamiento"])
    ),
    range: asString(asString(pickFirst(s, ["range", "alcance"]))),
    duration: asString(pickFirst(s, ["duration", "duracion", "duraci\u00f3n"])),
    ritual: asBool(s.ritual),
    concentration: asBool(pickFirst(s, ["concentration", "concentracion", "concentraci\u00f3n"])),
    attackType: asString(s.attack_type),
    damageType: refIndex(damageRaw.damage_type),
    saveAbility: refIndex(asRecord(dcRaw.dc_type)),
    hasHealing,
    hasAreaOfEffect,
    classes: toStringArray(classesRaw),
    components: toStringArray(componentsRaw),
    data: s,
  };

  return { id, name, payload };
}

function normalizeItem(raw: unknown): { id: string; name: string; payload: JsonRecord } | null {
  const item = asRecord(raw);
  const id = asString(pickFirst(item, ["id", "slug", "index", "name"]));
  const name = asString(item.name);
  if (!id || !name) return null;
  return { id, name, payload: { name, data: item } };
}

async function runChunkedUpsert<T>(
  records: T[],
  worker: (entry: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map((entry) => worker(entry)));
  }
}

async function seedSpells(dataDir: string): Promise<SeedStats> {
  const stats: SeedStats = {
    entity: "spells",
    total: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const spellsPath = path.join(dataDir, "spells.json");
  if (!fs.existsSync(spellsPath)) return stats;

  const spellsData = JSON.parse(fs.readFileSync(spellsPath, "utf8")) as unknown[];
  stats.total = spellsData.length;

  const normalized = spellsData
    .map((entry, idx) => {
      const out = normalizeSpell(entry);
      if (!out) {
        stats.skipped++;
        stats.failures.push({ id: `row:${idx}`, reason: "Missing spell id/name" });
      }
      return out;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  await runChunkedUpsert(normalized, async (spell) => {
    try {
      await db.srdSpell.upsert({
        where: { id: spell.id },
        update: spell.payload,
        create: { id: spell.id, ...spell.payload },
      });
      stats.upserted++;
    } catch (e) {
      stats.failed++;
      stats.failures.push({ id: spell.id, reason: (e as Error).message });
    }
  });

  return stats;
}

async function seedItems(dataDir: string): Promise<SeedStats> {
  const stats: SeedStats = {
    entity: "items",
    total: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const equipmentPath = path.join(dataDir, "equipment.json");
  if (!fs.existsSync(equipmentPath)) return stats;

  const itemsData = JSON.parse(fs.readFileSync(equipmentPath, "utf8")) as unknown[];
  stats.total = itemsData.length;

  const normalized = itemsData
    .map((entry, idx) => {
      const out = normalizeItem(entry);
      if (!out) {
        stats.skipped++;
        stats.failures.push({ id: `row:${idx}`, reason: "Missing item id/name" });
      }
      return out;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  await runChunkedUpsert(normalized, async (item) => {
    try {
      await db.srdItem.upsert({
        where: { id: item.id },
        update: item.payload,
        create: { id: item.id, ...item.payload },
      });
      stats.upserted++;
    } catch (e) {
      stats.failed++;
      stats.failures.push({ id: item.id, reason: (e as Error).message });
    }
  });

  return stats;
}

async function seedMonsters(dataDir: string): Promise<SeedStats> {
  const stats: SeedStats = {
    entity: "monsters",
    total: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const monstersPath = path.join(dataDir, "monsters.json");
  if (!fs.existsSync(monstersPath)) return stats;

  const monstersData = JSON.parse(fs.readFileSync(monstersPath, "utf8")) as unknown[];
  stats.total = monstersData.length;

  const normalized = monstersData
    .map((entry, idx) => {
      const out = normalizeMonster(entry);
      if (!out) {
        stats.skipped++;
        stats.failures.push({ id: `row:${idx}`, reason: "Missing monster id/name" });
      }
      return out;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  await runChunkedUpsert(normalized, async (monster) => {
    try {
      await db.srdMonster.upsert({
        where: { id: monster.id },
        update: monster.payload,
        create: { id: monster.id, ...monster.payload },
      });
      stats.upserted++;
    } catch (e) {
      stats.failed++;
      stats.failures.push({ id: monster.id, reason: (e as Error).message });
    }
  });

  return stats;
}

function printStats(stats: SeedStats): void {
  console.log(
    `[seed:${stats.entity}] total=${stats.total} upserted=${stats.upserted} skipped=${stats.skipped} failed=${stats.failed}`
  );
  if (stats.failures.length > 0) {
    const sample = stats.failures.slice(0, 10);
    console.log(`[seed:${stats.entity}] sample failures:`);
    for (const f of sample) {
      console.log(`  - ${f.id}: ${f.reason}`);
    }
  }
}

async function main() {
  const dataDir = path.join(__dirname, "../data/srd-es");

  const [spellsStats, itemsStats, monstersStats] = await Promise.all([
    seedSpells(dataDir),
    seedItems(dataDir),
    seedMonsters(dataDir),
  ]);

  printStats(spellsStats);
  printStats(itemsStats);
  printStats(monstersStats);

  const failedTotal = spellsStats.failed + itemsStats.failed + monstersStats.failed;
  if (failedTotal > 0) {
    console.warn(`[seed] completed with ${failedTotal} failed upserts (non-fatal).`);
  } else {
    console.log("[seed] completed successfully.");
  }
}

main()
  .catch((e) => {
    console.error("Fatal error during seeding:", (e as Error).message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
