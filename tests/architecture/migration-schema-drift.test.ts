/**
 * Detector de deriva entre prisma/migrations y prisma/schema.prisma.
 *
 * Motivación: las columnas de progresión de Character entraron en el esquema en
 * 310c14c y 7dd2733 sin migración asociada — se aplicaron con `db push` y nunca
 * se reconciliaron. El resultado fue que una base construida desde el historial
 * de migraciones no podía ni crear un Character (Prisma P2022).
 *
 * Esta comprobación es estática: parsea el esquema y el SQL, no necesita
 * PostgreSQL y corre en milisegundos, así que puede vivir en la suite normal.
 * La verificación completa contra una base real vive en
 * `scripts/check-migration-drift.mjs`, que es opt-in.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "prisma", "migrations");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");

const NEW_MIGRATION = "20260806090000_reconcile_character_progression_columns";

// ─── Parsers ligeros ─────────────────────────────────────────────────────────

/** Modelos declarados en schema.prisma -> columnas reales (sin campos de relación). */
function schemaColumns(): Map<string, Set<string>> {
  const modelNames = new Set([...SCHEMA.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));
  const out = new Map<string, Set<string>>();

  for (const block of SCHEMA.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, model, body] = block;
    const cols = new Set<string>();
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@") || line.startsWith("///")) continue;
      const m = line.match(/^(\w+)\s+([\w"()\s,-]+?)(\?|\[\])?\s*(@.*)?$/);
      if (!m) continue;
      const [, field, typeRaw] = m;
      const type = typeRaw.trim().replace(/\?|\[\]/g, "").split(/[\s(]/)[0];
      // Un campo cuyo tipo es otro modelo es una relación: no tiene columna.
      if (modelNames.has(type)) continue;
      cols.add(field);
    }
    out.set(model, cols);
  }
  return out;
}

/** Columnas que el historial de migraciones llega a crear, por tabla. */
function migratedColumns(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (table: string, col: string) => {
    if (!out.has(table)) out.set(table, new Set());
    out.get(table)!.add(col);
  };

  for (const dir of readdirSync(MIGRATIONS_DIR).filter((d) => /^\d/.test(d)).sort()) {
    const file = join(MIGRATIONS_DIR, dir, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, "utf8");

    for (const t of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"(\w+)"\s*\(([\s\S]*?)\n\);/g)) {
      const [, table, body] = t;
      for (const c of body.matchAll(/^\s{2,}"(\w+)"\s+/gm)) add(table, c[1]);
    }
    for (const a of sql.matchAll(/ALTER TABLE\s+"(\w+)"([\s\S]*?);/g)) {
      const [, table, body] = a;
      for (const c of body.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"(\w+)"/g)) add(table, c[1]);
    }
  }
  return out;
}

/**
 * Deriva conocida y todavía pendiente, fuera del alcance de esta rama.
 * Cada entrada es deuda real: el historial de migraciones no la crea.
 * Si una de estas se resuelve, este test falla y hay que quitarla de la lista —
 * así el inventario no se queda obsoleto en silencio.
 */
const KNOWN_OUTSTANDING_DRIFT: Record<string, string[]> = {
  Campaign: ["currentLocationId", "currentNodeId", "gold"],
  Combatant: ["concentrationSpellId", "size", "stats", "x", "y"],
  Encounter: ["totalDamageDealt"],
  InventoryItem: ["indexSlug"],
  NPC: ["concentrationSpellId", "disposition", "hasMetPlayer", "knownRumors", "personalityTags"],
};

/** Modelos que el historial no crea en absoluto. Deuda separada, no de progresión. */
const KNOWN_MISSING_TABLES = [
  "CampaignTime", "Haven", "Location", "LocationEdge", "LocationNode",
  "PartyInventory", "Retainer", "SrdCondition", "SrdEquipment",
  "TravelState", "WildernessMap",
];

// ─── El fence de progresión ──────────────────────────────────────────────────

describe("las columnas de progresión de Character están cubiertas por migraciones", () => {
  const schema = schemaColumns();
  const migrated = migratedColumns();
  const PROGRESSION = ["level", "xp", "hp", "maxHp", "hitDiceTotal", "hitDiceRemaining", "exhaustionLevel"];

  it.each(PROGRESSION)("Character.%s existe en el historial de migraciones", (col) => {
    expect(schema.get("Character")!.has(col)).toBe(true);
    expect(migrated.get("Character")!.has(col)).toBe(true);
  });

  it("ninguna columna de Character queda sin migración", () => {
    const missing = [...schema.get("Character")!].filter((c) => !migrated.get("Character")!.has(c));
    expect(missing).toEqual([]);
  });
});

describe("detección general de deriva", () => {
  const schema = schemaColumns();
  const migrated = migratedColumns();

  it("no aparece deriva nueva fuera del inventario conocido", () => {
    const unexpected: string[] = [];
    for (const [model, cols] of schema) {
      if (KNOWN_MISSING_TABLES.includes(model)) continue;
      const known = new Set(KNOWN_OUTSTANDING_DRIFT[model] ?? []);
      const have = migrated.get(model);
      if (!have) { unexpected.push(`${model} (tabla entera)`); continue; }
      for (const col of cols) {
        if (!have.has(col) && !known.has(col)) unexpected.push(`${model}.${col}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("el inventario de deriva conocida sigue siendo exacto", () => {
    const alreadyFixed: string[] = [];
    for (const [model, cols] of Object.entries(KNOWN_OUTSTANDING_DRIFT)) {
      for (const col of cols) {
        if (migrated.get(model)?.has(col)) alreadyFixed.push(`${model}.${col}`);
      }
    }
    // Si algo de aquí ya está migrado, quítalo de KNOWN_OUTSTANDING_DRIFT.
    expect(alreadyFixed).toEqual([]);
  });
});

// ─── Contrato de la migración correctiva ─────────────────────────────────────

describe("migración 20260806090000_reconcile_character_progression_columns", () => {
  const file = join(MIGRATIONS_DIR, NEW_MIGRATION, "migration.sql");
  const sql = existsSync(file) ? readFileSync(file, "utf8") : "";

  it("1. existe", () => {
    expect(existsSync(file)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it("2. solo altera la tabla Character", () => {
    const tables = new Set([...sql.matchAll(/(?:ALTER|CREATE|INSERT INTO|UPDATE)\s+(?:TABLE\s+)?"(\w+)"/g)].map((m) => m[1]));
    expect([...tables]).toEqual(["Character"]);
  });

  it("3. no contiene sentencias destructivas", () => {
    for (const bad of ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM", "DROP CONSTRAINT", "DROP INDEX"]) {
      expect(sql.toUpperCase()).not.toContain(bad);
    }
  });

  it("4. no toca modelos del grupo C", () => {
    for (const t of KNOWN_MISSING_TABLES) expect(sql).not.toContain(`"${t}"`);
  });

  it("5. protege contra columnas ya existentes", () => {
    const adds = [...sql.matchAll(/ADD COLUMN(\s+IF NOT EXISTS)?/g)];
    expect(adds.length).toBe(3);
    expect(adds.every((m) => m[1])).toBe(true);
  });

  it("6. rellena los nulos antes de poner NOT NULL", () => {
    const lastUpdate = sql.lastIndexOf("UPDATE \"Character\"");
    const firstNotNull = sql.indexOf("SET NOT NULL");
    expect(lastUpdate).toBeGreaterThan(-1);
    expect(firstNotNull).toBeGreaterThan(lastUpdate);
  });

  it("7. no sobrescribe valores no nulos", () => {
    const updates = [...sql.matchAll(/UPDATE "Character"[\s\S]*?;/g)].map((m) => m[0]);
    expect(updates).toHaveLength(3);
    for (const u of updates) expect(u).toMatch(/WHERE\s+"\w+"\s+IS NULL/);
  });

  it("8. mantiene hitDiceRemaining <= hitDiceTotal", () => {
    expect(sql).toMatch(/SET "hitDiceRemaining" = LEAST\(/);
    expect(sql).toContain('"hitDiceRemaining" > "hitDiceTotal"');
    expect(sql).toContain("RAISE EXCEPTION");
  });

  it("9. no asigna 1 indiscriminadamente: deriva del nivel persistido", () => {
    expect(sql).toMatch(/SET "hitDiceTotal" = GREATEST\("level", 1\)/);
    expect(sql).not.toMatch(/SET "hitDiceTotal" = 1\s*$/m);
    // Añadirlas con DEFAULT rellenaría las filas existentes con la constante.
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS "hitDice\w+" INTEGER NOT NULL DEFAULT/);
  });

  it("10. los defaults finales coinciden con schema.prisma", () => {
    const declared = (field: string) =>
      SCHEMA.match(new RegExp(`^\\s+${field}\\s+Int\\s+@default\\((\\d+)\\)`, "m"))?.[1];
    expect(declared("hitDiceTotal")).toBe("1");
    expect(declared("hitDiceRemaining")).toBe("1");
    expect(declared("exhaustionLevel")).toBe("0");

    expect(sql).toContain('ALTER COLUMN "hitDiceTotal"     SET DEFAULT 1');
    expect(sql).toContain('ALTER COLUMN "hitDiceRemaining" SET DEFAULT 1');
    expect(sql).toContain('ALTER COLUMN "exhaustionLevel"  SET DEFAULT 0');
    for (const c of ["hitDiceTotal", "hitDiceRemaining", "exhaustionLevel"]) {
      expect(sql).toMatch(new RegExp(`ALTER COLUMN "${c}"\\s+SET NOT NULL`));
    }
  });

  it("no introduce restricciones que schema.prisma no declara", () => {
    // Una CHECK aquí crearía deriva en sentido inverso y fijaría política de
    // juego en SQL. La invariante se protege con el backfill y el aborto.
    expect(sql.toUpperCase()).not.toContain("ADD CONSTRAINT");
    expect(sql.toUpperCase()).not.toContain("CHECK (");
  });

  it("es la última migración del historial", () => {
    const all = readdirSync(MIGRATIONS_DIR).filter((d) => /^\d/.test(d)).sort();
    expect(all[all.length - 1]).toBe(NEW_MIGRATION);
  });
});
