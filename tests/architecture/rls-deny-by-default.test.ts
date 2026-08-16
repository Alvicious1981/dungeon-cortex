/**
 * Contrato de RLS deny-by-default sobre prisma/migrations.
 *
 * Motivación: las 23 tablas de "public" tienen RLS desactivado y cero policies,
 * mientras el Data API de Supabase está publicado en Internet y acepta la anon
 * key. Hoy no expone nada solo porque el USAGE sobre "public" está revocado para
 * anon/authenticated/service_role — un REVOKE que es estado vivo de base de
 * datos y que ninguna migración reproduce. Un entorno nuevo construido desde
 * este historial arrancaría con los defaults de Supabase y quedaría abierto.
 *
 * 20260816120000_enable_rls_deny_by_default cierra eso para las tablas que ya
 * existen. Pero un barrido solo puede alcanzar lo que existe cuando se ejecuta:
 * una tabla creada por una migración POSTERIOR nace sin RLS. Ese es el flanco
 * que cubre este archivo, y es la mitad más importante del contrato.
 *
 * La comprobación es estática: parsea el esquema y el SQL, no necesita
 * PostgreSQL y corre en milisegundos, así que vive en la suite normal — igual
 * que migration-schema-drift.test.ts, del que reutiliza el patrón de parseo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "prisma", "migrations");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");

const SWEEP = "20260816120000_enable_rls_deny_by_default";

/**
 * Tablas deliberadamente fuera del alcance del barrido. NO es una lista de
 * excepciones toleradas para el modelo de aplicación: una tabla de aplicación
 * sin RLS es deuda de seguridad, y este archivo no admite escotilla para eso.
 *
 * "_prisma_migrations" es la contabilidad del motor de migraciones, no modelo de
 * aplicación: su contenido ya es público en el repositorio, y activarle RLS
 * arriesga dejar el motor sin poder leer su propio historial si alguna vez corre
 * con un rol sin BYPASSRLS.
 */
const TECHNICAL_EXCLUSIONS = ["_prisma_migrations"];

// ─── Parsers ligeros ─────────────────────────────────────────────────────────

/** Directorios de migración en orden cronológico: el prefijo YYYYMMDDHHMMSS lo garantiza. */
function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => /^\d/.test(d))
    .sort();
}

function migrationSql(dir: string): string {
  const file = join(MIGRATIONS_DIR, dir, "migration.sql");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** SQL sin comentarios de línea: lo único que el motor llega a ejecutar. */
function executable(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

/** Marca temporal de 14 dígitos de un directorio de migración. */
const stamp = (dir: string) => dir.slice(0, 14);

/**
 * Estrictamente anterior al barrido. La igualdad NO cuenta como cubierta: ante
 * un empate de marca temporal, la dirección segura es exigir el RLS explícito.
 */
const coveredBySweep = (dir: string) => stamp(dir) < stamp(SWEEP);

/**
 * Nombre de tabla de un CREATE TABLE, tolerante a las formas que aparecen en
 * el historial real de PostgreSQL/Prisma:
 *
 *   CREATE TABLE "Foo" (...)                 CREATE TABLE Foo (...)
 *   CREATE TABLE IF NOT EXISTS "Foo" (...)    CREATE TABLE IF NOT EXISTS Foo (...)
 *   CREATE TABLE public."Foo" (...)           CREATE TABLE public.Foo (...)
 *
 * No es un parser SQL general: solo reconoce el nombre de tabla que sigue
 * inmediatamente a CREATE TABLE, con o sin IF NOT EXISTS, con o sin prefijo de
 * esquema (comillado o no), y con o sin comillas en el propio nombre de tabla.
 * El prefijo de esquema es un grupo no-capturador que solo consume si le sigue
 * un punto; si no hay punto, se descarta y el nombre se captura igual —así
 * "Foo" y Foo se reconocen tanto con prefijo de esquema como sin él.
 */
const CREATE_TABLE_RE =
  /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:"?\w+"?\s*\.\s*)?"?(\w+)"?/g;

function extractCreatedTables(code: string): string[] {
  return [...code.matchAll(CREATE_TABLE_RE)].map((m) => m[1]);
}

/**
 * Tabla -> PRIMERA migración que la crea.
 *
 * La primera, no la última: las migraciones de reconciliación de este
 * repositorio usan `CREATE TABLE IF NOT EXISTS` sobre tablas que ya existen, y
 * quedarse con la última aparición marcaría como "nueva" una tabla antigua.
 */
function createdTables(): Map<string, string> {
  const out = new Map<string, string>();
  for (const dir of migrationDirs()) {
    const code = executable(migrationSql(dir));
    for (const table of extractCreatedTables(code)) {
      if (!out.has(table)) out.set(table, dir);
    }
  }
  return out;
}

/** Tablas con un ENABLE ROW LEVEL SECURITY explícito en alguna migración. */
function rlsExplicitTables(): Set<string> {
  const out = new Set<string>();
  for (const dir of migrationDirs()) {
    const code = executable(migrationSql(dir));
    for (const m of code.matchAll(
      /ALTER TABLE\s+(?:"?public"?\s*\.\s*)?"(\w+)"[^;]*ENABLE ROW LEVEL SECURITY/gi,
    )) {
      out.add(m[1]);
    }
  }
  return out;
}

/**
 * Tablas de `created` posteriores al barrido que no tienen RLS explícito.
 * Función pura, sin tocar disco: además de usarla contra el historial real,
 * permite probarla con entradas sintéticas (ver "regresión sintética" más
 * abajo) sin depender de una migración de prueba en el repositorio.
 */
function missingRlsAfterSweep(created: Map<string, string>, explicit: Set<string>): string[] {
  const missing: string[] = [];
  for (const [table, dir] of created) {
    if (TECHNICAL_EXCLUSIONS.includes(table)) continue;
    if (coveredBySweep(dir)) continue;
    if (explicit.has(table)) continue;
    missing.push(
      `${table} se crea en ${dir}, posterior al barrido ${SWEEP}. ` +
        `Añade ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY; en esa misma migración.`,
    );
  }
  return missing;
}

/** Modelos declarados en schema.prisma. Sin @@map, el nombre del model es el de la tabla. */
function schemaModels(): string[] {
  return [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

/** Literales entre comillas simples del SQL ejecutable. */
function singleQuotedLiterals(code: string): string[] {
  return [...code.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
}

// ─── Contrato de la migración de barrido ─────────────────────────────────────

describe("migración 20260816120000_enable_rls_deny_by_default", () => {
  const sql = migrationSql(SWEEP);
  const code = executable(sql);

  it("1. existe", () => {
    expect(existsSync(join(MIGRATIONS_DIR, SWEEP, "migration.sql"))).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
    expect(migrationDirs()).toContain(SWEEP);
  });

  it("2. es una sola sentencia: bloque DO único, sin BEGIN/COMMIT sueltos", () => {
    // Un bloque DO es atómico en cualquier invocación, incluido psql en
    // autocommit. Un BEGIN/COMMIT explícito no sirve: anidado bajo la
    // transacción de Prisma, el COMMIT cae sobre una transacción ya abortada.
    expect([...sql.matchAll(/^DO \$(\w+)\$/gm)]).toHaveLength(1);
    expect(sql).not.toMatch(/^\s*BEGIN;/m);
    expect(sql).not.toMatch(/^\s*COMMIT;/m);
  });

  it("3. no contiene ninguna escritura de datos", () => {
    for (const verb of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "MERGE", "COPY"]) {
      expect(code.toUpperCase()).not.toMatch(new RegExp(`\\b${verb}\\b`));
    }
  });

  it("4. no contiene DDL de esquema", () => {
    for (const ddl of ["CREATE TABLE", "ADD COLUMN", "ALTER COLUMN", "DROP", "ADD CONSTRAINT"]) {
      expect(code.toUpperCase()).not.toContain(ddl);
    }
  });

  it("5. no reparte ni retira privilegios, ni inventa policies, ni fuerza RLS al owner", () => {
    for (const forbidden of [
      "CREATE POLICY",
      "GRANT",
      "REVOKE",
      "FORCE ROW LEVEL SECURITY",
      "DISABLE ROW LEVEL SECURITY",
    ]) {
      expect(code.toUpperCase()).not.toContain(forbidden);
    }
  });

  it("6. activa RLS en un único punto", () => {
    // Una sola aparición = un solo format() en el bucle. Más de una significaría
    // que alguien enumeró tablas a mano.
    expect([...code.matchAll(/ENABLE ROW LEVEL SECURITY/g)]).toHaveLength(1);
  });

  it("7. cualifica esquema y tabla: la sentencia no depende de search_path", () => {
    expect(code).toMatch(
      /format\(\s*'ALTER TABLE %I\.%I ENABLE ROW LEVEL SECURITY'\s*,\s*rec\.nspname\s*,\s*rec\.relname\s*,?\s*\)/,
    );
    // La variante de un solo identificador dependería de search_path.
    expect(code).not.toMatch(/'ALTER TABLE %I ENABLE/);
    // Y el esquema llega como argumento del catálogo, nunca incrustado en la plantilla.
    expect(code).not.toMatch(/'ALTER TABLE\s+public/i);
  });

  it("8. conserva el filtro de esquema", () => {
    expect(code).toMatch(/nspname = 'public'/);
  });

  it("9. es idempotente: solo toca tablas con RLS apagado", () => {
    expect(code).toMatch(/relrowsecurity = false/);
  });

  it("10. la única tabla nombrada literalmente es la exclusión técnica", () => {
    // Fija a la vez dos cosas: que la exclusión no crezca en silencio y que el
    // barrido no degenere en una lista enumerada de tablas.
    const structural = new Set([
      "public",
      "r",
      "p",
      "pg_class",
      "e",
      "ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY",
    ]);
    const literals = singleQuotedLiterals(code);
    expect(literals.filter((l) => !structural.has(l))).toEqual(TECHNICAL_EXCLUSIONS);
    // El conjunto completo, para que ningún literal nuevo entre sin revisión.
    expect([...new Set(literals)].sort()).toEqual(
      [...structural, ...TECHNICAL_EXCLUSIONS].sort(),
    );
  });

  it("11. no amplía su alcance a particiones ni a objetos de extensiones", () => {
    expect(code).toMatch(/relkind IN \('r', 'p'\)/);
    expect(code).toMatch(/NOT c\.relispartition/);
    expect(code).toMatch(/pg_depend/);
    expect(code).toMatch(/deptype = 'e'/);
  });

  it("12. no nombra ninguna tabla ni columna: el barrido sale del catálogo", () => {
    // Prisma entrecomilla todo identificador de aplicación. Que no haya ni una
    // comilla doble en el código ejecutable prueba que esta migración no
    // referencia ni una tabla ni una columna por su nombre.
    expect(code).not.toContain('"');
    for (const model of schemaModels()) {
      expect(code).not.toContain(model);
    }
  });
});

// ─── La guarda que cubre las tablas futuras ──────────────────────────────────
// El barrido solo alcanza lo que existe cuando se ejecuta. Esto es lo que hace
// que olvidar el RLS de una tabla nueva rompa CI en vez de pasar inadvertido.

describe("toda tabla creada después del barrido activa su propio RLS", () => {
  const created = createdTables();
  const explicit = rlsExplicitTables();

  it("ninguna tabla posterior al barrido se queda sin ENABLE ROW LEVEL SECURITY", () => {
    expect(missingRlsAfterSweep(created, explicit)).toEqual([]);
  });

  it("todo model de schema.prisma queda cubierto", () => {
    // Sin escotilla: a diferencia del inventario de deriva de
    // migration-schema-drift.test.ts, aquí no hay lista de excepciones. Un model
    // que ninguna migración crea es, en un entorno nuevo, una tabla sin RLS.
    const uncovered: string[] = [];
    for (const model of schemaModels()) {
      if (TECHNICAL_EXCLUSIONS.includes(model)) continue;
      const dir = created.get(model);
      if (!dir) {
        uncovered.push(`${model} no la crea ninguna migración: en una base nueva nacería sin RLS.`);
        continue;
      }
      if (!coveredBySweep(dir) && !explicit.has(model)) {
        uncovered.push(`${model} se crea en ${dir} y no activa RLS explícitamente.`);
      }
    }
    expect(uncovered).toEqual([]);
  });

  it("ningún model redefine su nombre de tabla con @@map", () => {
    // Si aparece @@map, el nombre del model deja de ser el de la tabla y las dos
    // comprobaciones de arriba darían un verde falso.
    expect(SCHEMA).not.toMatch(/@@map\s*\(/);
  });

  it("el barrido no crea tablas: su cobertura es solo la del catálogo", () => {
    expect([...created.entries()].filter(([, dir]) => dir === SWEEP)).toEqual([]);
  });
});

// ─── Detección de CREATE TABLE: comillas y cualificación de esquema ─────────
// Endurecimiento P2-2: una tabla creada sin comillas ("CREATE TABLE Foo (...)"
// en vez de "CREATE TABLE \"Foo\" (...)") era invisible para el guard de
// arriba — ni fallaba ni pasaba, simplemente no se detectaba como creada. Este
// bloque fija, variante por variante, que extractCreatedTables() la reconoce.

describe("extractCreatedTables — comillas opcionales y cualificación de esquema opcional", () => {
  it.each([
    ['CREATE TABLE "Foo" (id TEXT);', "Foo"],
    ["CREATE TABLE Foo (id TEXT);", "Foo"],
    ['CREATE TABLE IF NOT EXISTS "Foo" (id TEXT);', "Foo"],
    ["CREATE TABLE IF NOT EXISTS Foo (id TEXT);", "Foo"],
    ['CREATE TABLE public."Foo" (id TEXT);', "Foo"],
    ["CREATE TABLE public.Foo (id TEXT);", "Foo"],
    ['CREATE TABLE IF NOT EXISTS public."Foo" (id TEXT);', "Foo"],
    ["CREATE TABLE IF NOT EXISTS public.Foo (id TEXT);", "Foo"],
    ["CREATE TABLE FutureTable (id TEXT);", "FutureTable"],
  ])("%s -> detecta %s", (sql, expected) => {
    expect(extractCreatedTables(sql)).toEqual([expected]);
  });

  it("sigue reconociendo las 22 tablas reales del historial actual", () => {
    // No-regresión directa: el cambio de regex no puede perder ni una sola de
    // las tablas que ya detectaba la versión anterior (todas entrecomilladas,
    // sin prefijo de esquema).
    expect(createdTables().size).toBe(22);
  });
});

// ─── Regresión sintética: CREATE TABLE sin comillas tras el barrido ─────────
// Reproduce exactamente el escenario de P2-2 sin crear ninguna migración de
// prueba en el repositorio: construye a mano el `created`/`explicit` que
// produciría una migración así, y ejercita la misma función pura que usa el
// guard real.

describe("regresión sintética: CREATE TABLE sin comillas posterior al barrido", () => {
  const DIR_AFTER_SWEEP = "20990101000000_add_future_table";

  it("CREATE TABLE FutureTable (id TEXT); se detecta como tabla creada", () => {
    expect(extractCreatedTables("CREATE TABLE FutureTable (id TEXT);")).toEqual(["FutureTable"]);
  });

  it("sin ENABLE ROW LEVEL SECURITY explícito, el guard falla con un mensaje accionable", () => {
    const created = new Map([["FutureTable", DIR_AFTER_SWEEP]]);
    const explicit = new Set<string>();
    const missing = missingRlsAfterSweep(created, explicit);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("FutureTable");
    expect(missing[0]).toContain(DIR_AFTER_SWEEP);
    expect(missing[0]).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("con ENABLE ROW LEVEL SECURITY explícito, el guard queda satisfecho", () => {
    const created = new Map([["FutureTable", DIR_AFTER_SWEEP]]);
    const explicit = new Set(["FutureTable"]);
    expect(missingRlsAfterSweep(created, explicit)).toEqual([]);
  });

  it("una tabla homónima creada ANTES del barrido no exige RLS explícito", () => {
    // coveredBySweep() sigue decidiendo la cobertura por fecha; esta
    // regresión no debe convertir en obligatorio algo que el barrido de
    // 20260816120000 ya cubre.
    const created = new Map([["FutureTable", "20260330071218_init"]]);
    const explicit = new Set<string>();
    expect(missingRlsAfterSweep(created, explicit)).toEqual([]);
  });
});

// ─── Guarda de no regresión sobre todo el historial ──────────────────────────

describe("el historial de migraciones no desactiva RLS", () => {
  it("ninguna migración contiene DISABLE ROW LEVEL SECURITY", () => {
    const offenders = migrationDirs().filter((dir) =>
      /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(executable(migrationSql(dir))),
    );
    expect(offenders).toEqual([]);
  });

  it("ninguna migración concede privilegios a anon o authenticated", () => {
    // Un GRANT a esos roles reabriría el Data API por debajo de RLS.
    const offenders = migrationDirs().filter((dir) =>
      /GRANT[\s\S]{0,200}?\b(anon|authenticated)\b/i.test(executable(migrationSql(dir))),
    );
    expect(offenders).toEqual([]);
  });
});
