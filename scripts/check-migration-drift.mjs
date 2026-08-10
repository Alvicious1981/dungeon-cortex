#!/usr/bin/env node
/**
 * Comprobación opt-in de deriva contra un PostgreSQL real.
 *
 * Construye una base desde cero SOLO con `prisma migrate deploy` y la compara
 * con prisma/schema.prisma mediante `prisma migrate diff`. Es la contraparte
 * "de verdad" del test estático tests/architecture/migration-schema-drift.test.ts,
 * que no necesita base de datos y sí corre en la suite normal.
 *
 * No se ejecuta en `pnpm test` a propósito: requiere PostgreSQL, y el CI actual
 * no lo ofrece. Ver el README de más abajo para la recomendación de CI.
 *
 * Uso:
 *   DRIFT_CHECK_DATABASE_URL="postgresql://<USUARIO>:<CLAVE>@127.0.0.1:5432/<BASE>" \
 *     node scripts/check-migration-drift.mjs
 *
 * La base indicada se usa tal cual y debe estar VACÍA y ser desechable.
 * El script no crea ni destruye bases: eso queda en manos de quien lo invoca.
 *
 * Salida:
 *   0 -> sin deriva en Character (el fence que esta comprobación protege)
 *   1 -> deriva detectada en Character, o error de ejecución
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DRIFT_CHECK_DATABASE_URL;

if (!url) {
  console.error("Falta DRIFT_CHECK_DATABASE_URL. Apúntala a un PostgreSQL vacío y desechable.");
  console.error("Ejemplo:");
  console.error("  docker run -d --name drift-pg -e POSTGRES_PASSWORD=<CLAVE> -p 5432:5432 pgvector/pgvector:pg16");
  console.error("  DRIFT_CHECK_DATABASE_URL=postgresql://postgres:<CLAVE>@127.0.0.1:5432/postgres \\");
  console.error("    node scripts/check-migration-drift.mjs");
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };

// Se invoca el entrypoint JS con `node` en lugar del shim de node_modules/.bin:
// Node 20+ rechaza lanzar un .cmd con execFile (EINVAL) en Windows, y esta vía
// funciona igual en los tres sistemas.
const PRISMA_JS = createRequire(import.meta.url).resolve("prisma/build/index.js");
const prisma = (...args) =>
  execFileSync(process.execPath, [PRISMA_JS, ...args],
    { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

console.log("1/2  prisma migrate deploy sobre la base indicada…");
try {
  const out = prisma("migrate", "deploy");
  console.log("     " + (out.match(/(\d+) migrations? found/)?.[0] ?? "aplicadas"));
} catch (e) {
  console.error("     FALLÓ migrate deploy:\n" + (e.stdout || e.message));
  process.exit(1);
}

console.log("2/2  prisma migrate diff (migraciones -> schema.prisma)…");
let diff = "";
try {
  diff = prisma("migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--script");
} catch (e) {
  console.error("     FALLÓ migrate diff:\n" + (e.stdout || e.message));
  process.exit(1);
}

const characterStatements = diff
  .split(/;\s*\n/)
  .filter((s) => /"Character"/.test(s))
  .map((s) => s.trim().replace(/\s+/g, " "));

const summary = {
  tablasAusentes: [...new Set([...diff.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]))],
  columnasAusentes: [...diff.matchAll(/ALTER TABLE "(\w+)"|ADD COLUMN\s+"(\w+)"/g)].length,
  extensiones: [...new Set([...diff.matchAll(/CREATE EXTENSION[^"]*"([\w-]+)"/g)].map((m) => m[1]))],
};

console.log("\n--- deriva restante, conocida y fuera del alcance de esta comprobación ---");
console.log("    tablas ausentes: " + (summary.tablasAusentes.join(", ") || "ninguna"));
console.log("    extensiones:     " + (summary.extensiones.join(", ") || "ninguna"));

if (characterStatements.length > 0) {
  console.error("\nDERIVA DETECTADA EN Character:");
  characterStatements.forEach((s) => console.error("    " + s));
  console.error("\nAñade una migración que cubra esas columnas antes de continuar.");
  process.exit(1);
}

console.log("\nOK: el historial de migraciones y schema.prisma coinciden para Character.");
process.exit(0);
