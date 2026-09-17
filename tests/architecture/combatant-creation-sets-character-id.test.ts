/**
 * DC-PARTY-002: toda creación de un Combatant con isPlayer:true debe fijar
 * characterId en el mismo literal. Estático — no necesita PostgreSQL.
 *
 * Cierra en tiempo de revisión el riesgo residual anotado en la spec §7: un
 * tercer sitio de creación que olvide characterId.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

const CREATION_SITES = [
  join(ROOT, "app", "api", "campaign", "[id]", "encounter", "route.ts"),
  join(ROOT, "lib", "rules", "encounter-service.ts"),
];

describe("todo Combatant isPlayer:true fija characterId en su propia creación", () => {
  it.each(CREATION_SITES)("%s", (path) => {
    const source = readFileSync(path, "utf8");
    // Localiza el objeto literal que contiene "isPlayer: true," y confirma
    // que characterId aparece en las ~15 líneas siguientes (el mismo objeto).
    const idx = source.indexOf("isPlayer: true,");
    expect(idx).toBeGreaterThan(-1);
    const window = source.slice(idx, idx + 600);
    expect(window).toContain("characterId");
  });

  // Deliberately no "detect an unknown third creation site" test: a bare
  // `isPlayer: true` text search matches 42 files (read-side filters like
  // campaign-guard.ts's `where: { isPlayer: true }`, and legitimate test
  // fixtures), and a `.combatant.create(Many)?(` call-site search misses
  // encounter-service.ts entirely — it builds the data object but does not
  // call .create() itself, its caller does. Both were verified against this
  // repository (pre-flight scan, DC-PARTY-002) and neither is precise enough
  // to be worth the false-positive/false-negative risk. CREATION_SITES above
  // is manually maintained; a third creation path requires adding it here.
});
