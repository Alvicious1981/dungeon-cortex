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
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS "hitDice\w+" INTEGER (NOT NULL |)DEFAULT/);
  });

  it("10. los defaults finales coinciden con schema.prisma", () => {
    const declared = (field: string) =>
      SCHEMA.match(new RegExp(`^\\s+${field}\\s+Int\\s+@default\\((\\d+)\\)`, "m"))?.[1];
    expect(declared("hitDiceTotal")).toBe("1");
    expect(declared("hitDiceRemaining")).toBe("1");
    expect(declared("exhaustionLevel")).toBe("0");

    expect(sql).toContain('ALTER COLUMN "hitDiceTotal" SET DEFAULT 1');
    expect(sql).toContain('ALTER COLUMN "hitDiceRemaining" SET DEFAULT 1');
    expect(sql).toContain('ALTER COLUMN "exhaustionLevel" SET DEFAULT 0');
    for (const c of ["hitDiceTotal", "hitDiceRemaining", "exhaustionLevel"]) {
      expect(sql).toMatch(new RegExp(`ALTER COLUMN "${c}"\\s+SET NOT NULL`));
    }
  });


  // ─── Endurecimiento adversarial ────────────────────────────────────────────

  it("11. es una sola sentencia: bloque DO único, sin BEGIN/COMMIT sueltos", () => {
    // Un bloque DO es atómico en cualquier invocación, incluido psql en
    // autocommit. Un BEGIN/COMMIT explícito no sirve: anidado bajo la
    // transacción de Prisma, el COMMIT cae sobre una transacción ya abortada y
    // sustituye el RAISE por un genérico "current transaction is aborted".
    const doBlocks = [...sql.matchAll(/^DO \$(\w+)\$/gm)];
    expect(doBlocks).toHaveLength(1);
    expect(sql).not.toMatch(/^\s*BEGIN;/m);
    expect(sql).not.toMatch(/^\s*COMMIT;/m);
  });

  it("12. todo el DDL vive dentro del bloque DO, así que revierte con él", () => {
    const start = sql.indexOf("DO $reconcile_character_progression$");
    const end = sql.lastIndexOf("$reconcile_character_progression$;");
    for (const m of sql.matchAll(/ALTER TABLE "Character"/g)) {
      expect(m.index).toBeGreaterThan(start);
      expect(m.index).toBeLessThan(end);
    }
  });

  it("13. la guarda de tipos precede a cualquier ADD COLUMN", () => {
    const typeGuard = sql.indexOf("data_type <> 'integer'");
    const firstAdd = sql.indexOf("ADD COLUMN");
    expect(typeGuard).toBeGreaterThan(-1);
    expect(typeGuard).toBeLessThan(firstAdd);
    expect(sql).toContain("no convierte tipos");
  });

  it("14. no intenta ninguna conversión de tipo", () => {
    // ALTER COLUMN sí aparece, pero solo para SET DEFAULT y SET NOT NULL.
    // Lo prohibido es cambiar el tipo o forzar un cast sobre datos existentes.
    expect(sql).not.toMatch(/ALTER COLUMN\s+"\w+"\s+TYPE/i);
    expect(sql).not.toMatch(/\bUSING\b/i);
    expect(sql).not.toMatch(/::\s*(integer|int4|bigint|text|numeric)/i);

    // La única operación sobre columnas existentes es SET; nunca TYPE ni DROP.
    const verbs = [...sql.matchAll(/ALTER COLUMN\s+"\w+"\s+(\w+)/g)].map((m) => m[1]);
    expect(new Set(verbs)).toEqual(new Set(["SET"]));
    // Y cada SET solo fija default o nulabilidad: 3 + 3.
    expect([...sql.matchAll(/ALTER COLUMN\s+"\w+"\s+SET\s+DEFAULT\b/g)]).toHaveLength(3);
    expect([...sql.matchAll(/ALTER COLUMN\s+"\w+"\s+SET\s+NOT NULL\b/g)]).toHaveLength(3);
  });

  it("15. valida las invariantes DESPUÉS del backfill", () => {
    const lastUpdate = sql.lastIndexOf('UPDATE "Character"');
    const totalGuard = sql.indexOf('"hitDiceTotal" IS NULL OR "hitDiceTotal" < 1');
    const negGuard = sql.indexOf('"hitDiceRemaining" IS NULL OR "hitDiceRemaining" < 0');
    const overGuard = sql.lastIndexOf('"hitDiceRemaining" > "hitDiceTotal"');
    const notNull = sql.indexOf("SET NOT NULL");
    for (const g of [totalGuard, negGuard, overGuard]) {
      expect(g).toBeGreaterThan(lastUpdate);
      expect(g).toBeLessThan(notNull);
    }
  });

  it("16. cubre las cinco invariantes finales del contrato", () => {
    expect(sql).toContain('"hitDiceTotal" IS NULL OR "hitDiceTotal" < 1');
    expect(sql).toContain('"hitDiceRemaining" IS NULL OR "hitDiceRemaining" < 0');
    expect(sql).toContain('"hitDiceRemaining" > "hitDiceTotal"');
    expect(sql).toContain('"exhaustionLevel" IS NULL');
    expect([...sql.matchAll(/RAISE EXCEPTION/g)]).toHaveLength(6);
  });

  it("17. cada aborto lleva un mensaje accionable", () => {
    const raises = [...sql.matchAll(/RAISE EXCEPTION\s+'([^']+)'/g)].map((m) => m[1]);
    expect(raises).toHaveLength(6);
    for (const msg of raises) {
      expect(msg).toContain("No se puede reconciliar");
      expect(msg).toMatch(/vuelve a aplicarla|vuelve a aplicar la migración|corrige esas filas|Corrige esas filas|ajusta la columna/);
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

// ─── Contrato del arnés opt-in de progresión ─────────────────────────────────
// El arnés llegó a dar un falso verde: una línea con el nombre del contenedor
// fijado ignoraba SAFETY_PSQL, la siembra no llegaba a la base, las consultas
// de datos salían vacías y la aserción de idempotencia comparaba dos cadenas
// vacías. Estas pruebas fijan que eso no pueda repetirse.

describe("scripts/check-progression-migration-safety.sh — parametrización", () => {
  const file = join(ROOT, "scripts", "check-progression-migration-safety.sh");
  const sh = existsSync(file) ? readFileSync(file, "utf8") : "";
  /** Líneas ejecutables: sin comentarios ni líneas en blanco. */
  const code = sh
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l) && l.trim() !== "")
    .join("\n");

  it("existe", () => {
    expect(existsSync(file)).toBe(true);
    expect(sh.length).toBeGreaterThan(0);
  });

  it("1. no contiene ninguna referencia ejecutable a un contenedor fijo", () => {
    expect(code).not.toContain("dc-drift-pg");
    expect(code).not.toContain("dc-progression-audit-pg");
    expect(code).not.toMatch(/^\s*docker\s+exec/m);
  });

  it("1b. no fija usuario, base ni puerto dentro de las funciones", () => {
    expect(code).not.toMatch(/psql\s+-U\s+\w/);
    expect(code).not.toMatch(/-p\s+5432/);
  });

  it("2. toda ejecución pasa por la abstracción parametrizada", () => {
    // PSQL_CMD se construye desde SAFETY_PSQL y es el único punto de invocación.
    expect(code).toMatch(/read\s+-r\s+-a\s+PSQL_CMD\s+<<<\s+"\$SAFETY_PSQL"/);
    const invocations = [...code.matchAll(/"\$\{PSQL_CMD\[@\]\}"/g)];
    expect(invocations.length).toBeGreaterThanOrEqual(4);
    // Ninguna llamada suelta a psql fuera de la abstracción.
    expect(code).not.toMatch(/(^|[^_A-Za-z}])psql\s+-/m);
  });

  it("2b. no usa eval para interpretar la configuración", () => {
    expect(code).not.toMatch(/\beval\b/);
  });

  it("2c. es fail-fast", () => {
    expect(sh).toMatch(/^set -euo pipefail$/m);
  });

  it("3. comprueba que la siembra dejó datos", () => {
    expect(code).toContain("assert_seeded()");
    expect(code).toMatch(/se esperaba 1 usuario/);
    expect(code).toMatch(/se esperaban \$expected_chars personaje/);
    // Y se invoca en cada bloque adversarial.
    expect([...code.matchAll(/assert_seeded "\$DB"/g)].length).toBeGreaterThanOrEqual(8);
    expect([...code.matchAll(/assert_row "\$DB"/g)].length).toBeGreaterThanOrEqual(8);
  });

  it("4. la instantánea de idempotencia es verificable y no puede estar vacía", () => {
    expect(code).toContain("snapshot()");
    expect(code).toMatch(/0 filas en/);          // aborta si no hay filas
    expect(code).toMatch(/md5 vacío en/);        // aborta si el digest es vacío
    expect(code).toMatch(/\$\{#digest\}" -eq 32/); // estructura verificable
    // La comparación lleva el recuento de filas dentro del valor comparado.
    expect(code).toMatch(/count\(\*\)::text \|\| '\|'/);
  });

  it("5. propaga los errores inesperados en vez de convertirlos en cadena vacía", () => {
    // Ninguna redirección que descarte stderr en las funciones de consulta.
    expect(code).not.toContain("2>/dev/null");
    expect(code).toContain("die()");
    // qreq aborta ante salida vacía.
    expect(code).toMatch(/consulta vacía cuando debía devolver una fila/);
  });

  it("5b. los errores esperados se capturan explícitamente", () => {
    // Los bloques que esperan un aborto usan `|| true` sobre apply_migration,
    // nunca una redirección que oculte el fallo.
    expect([...code.matchAll(/apply_migration "\$DB" \|\| true/g)].length).toBeGreaterThanOrEqual(5);
    expect(code).toMatch(/apply_migration "\$DB" \|\| die/);
  });

  it("6. no puede imprimir éxito si falla una precondición", () => {
    const summaryAt = code.indexOf("RESUMEN:");
    const firstAssert = code.indexOf("assert_seeded");
    expect(firstAssert).toBeGreaterThan(-1);
    expect(summaryAt).toBeGreaterThan(firstAssert);
    // `die` sale con código != 0 antes de llegar al resumen.
    expect(code).toMatch(/die\(\)\s*\{[^}]*exit 1/);
    // El código de salida final es el número de fallos.
    expect(code).toMatch(/exit \$FAIL/);
  });

  it("documenta el ejemplo de Docker solo como comentario", () => {
    const commentLines = sh.split(/\r?\n/).filter((l) => /^\s*#/.test(l));
    expect(commentLines.join("\n")).toContain("docker exec -i <CONTENEDOR>");
    // …y ese ejemplo nunca aparece en el código ejecutable.
    expect(code).not.toContain("<CONTENEDOR>");
  });
});
